from datetime import date
from decimal import Decimal

from test_users import client  # noqa: F401  (pytest fixture)


def make_case(c, plate, work_type):
    customer = c.post("/api/v1/customers", json={"customer_type": "PRIVATE", "first_name": "Luca", "last_name": "Bianchi"}).json()
    vehicle = c.post("/api/v1/vehicles", json={"license_plate": plate, "customer_id": customer["id"]}).json()
    case = c.post("/api/v1/cases", json={"customer_id": customer["id"], "vehicle_id": vehicle["id"], "work_type": work_type})
    assert case.status_code == 201, case.text
    return case.json()


def approved_estimate(c, case, lines):
    estimate = c.post("/api/v1/estimates", json={"repair_case_id": case["id"]}).json()
    for line in lines:
        response = c.post(f"/api/v1/estimates/{estimate['id']}/lines", json={"vat_rate": "22", **line})
        assert response.status_code == 201, response.text
    response = c.patch(f"/api/v1/estimates/{estimate['id']}/status", json={"status": "APPROVED"})
    assert response.status_code == 200, response.text
    return estimate


def test_costs_are_split_by_meccanica_and_carrozzeria(client):
    c, _, _ = client
    mechanical = make_case(c, "GH482KL", "MECHANICAL")
    body = make_case(c, "FT219RX", "BODY")
    approved_estimate(c, mechanical, [
        {"category": "PART", "description": "Kit distribuzione", "oem_code": "KTB", "quantity": "1", "unit_price": "286.40", "markup_percent": "30"},
        {"category": "PART", "description": "Olio 5W30", "quantity": "5", "unit_price": "8.90"},
        {"category": "MECHANICAL_LABOR", "description": "Sostituzione", "quantity": "1", "unit_price": "0", "labor_hours": "6.5", "labor_rate": "45"},
        {"category": "EXTERNAL_SERVICE", "description": "Rigenerazione iniettori", "quantity": "1", "unit_price": "180"},
    ])
    approved_estimate(c, body, [
        {"category": "PART", "description": "Paraurti", "quantity": "1", "unit_price": "312"},
        {"category": "PAINT", "description": "Verniciatura", "quantity": "1", "unit_price": "0", "paint_hours": "4.5", "paint_rate": "45", "materials": "96"},
        {"category": "BODY_LABOR", "description": "Montaggio", "quantity": "1", "unit_price": "0", "labor_hours": "8", "labor_rate": "45"},
    ])
    # A rejected / unapproved estimate is not a cost.
    draft = c.post("/api/v1/estimates", json={"repair_case_id": body["id"]}).json()
    c.post(f"/api/v1/estimates/{draft['id']}/lines", json={"category": "PART", "description": "Non ordinato", "quantity": "1", "unit_price": "999", "vat_rate": "22"})

    for expense in (
        {"date": date.today().isoformat(), "description": "Affitto", "category": "AFFITTO", "area": "GENERAL", "amount": "1800"},
        {"date": date.today().isoformat(), "description": "Filtri forno", "category": "ATTREZZATURA", "area": "BODY", "supplier": " Blowtherm ", "amount": "380.00"},
    ):
        response = c.post("/api/v1/expenses", json=expense)
        assert response.status_code == 201, response.text

    today = date.today().isoformat()
    report = c.get(f"/api/v1/costs?from={today}&to={today}")
    assert report.status_code == 200, report.text
    data = report.json()
    mecc, carr = data["areas"]["MECHANICAL"], data["areas"]["BODY"]
    # Parts at purchase cost (the 30% markup is not a cost).
    assert Decimal(mecc["parts"]) == Decimal("330.90")
    assert Decimal(mecc["labor_hours"]) == Decimal("6.5")
    assert Decimal(mecc["labor_value"]) == Decimal("292.50")
    assert Decimal(mecc["external"]) == Decimal("180.00")
    assert Decimal(mecc["total"]) == Decimal("803.40")
    assert Decimal(carr["parts"]) == Decimal("312.00")
    assert Decimal(carr["labor_hours"]) == Decimal("8") and Decimal(carr["paint_hours"]) == Decimal("4.5")
    assert Decimal(carr["materials"]) == Decimal("96.00")
    assert Decimal(carr["expenses"]) == Decimal("380.00")
    assert Decimal(data["general_expenses"]) == Decimal("1800.00")
    assert {p["description"] for p in data["parts"]} == {"Kit distribuzione", "Olio 5W30", "Paraurti"}
    assert {h["plate"]: h["area"] for h in data["hours"]} == {"GH482KL": "MECHANICAL", "FT219RX": "BODY"}
    assert [e["supplier"] for e in data["expenses"]] == [None, "Blowtherm"]

    # Another period shows nothing.
    empty = c.get("/api/v1/costs?from=2020-01-01&to=2020-01-31").json()
    assert empty["parts"] == [] and empty["expenses"] == [] and empty["areas"]["BODY"]["total"] == "0.00"


def test_expenses_can_be_changed_and_deleted(client):
    c, _, _ = client
    created = c.post("/api/v1/expenses", json={"date": "2026-11-04", "description": "Bolletta luce", "category": "UTENZE", "amount": "412,60".replace(",", ".")}).json()
    assert created["area"] == "GENERAL"
    changed = c.put(f"/api/v1/expenses/{created['id']}", json={**created, "amount": "420", "area": "MECHANICAL"})
    assert changed.status_code == 200 and changed.json()["amount"] == "420.00"
    assert c.post("/api/v1/expenses", json={"date": "2026-11-04", "description": "  ", "amount": "1"}).status_code == 422
    assert c.post("/api/v1/expenses", json={"date": "2026-11-04", "description": "X", "category": "BOH", "amount": "1"}).status_code == 422
    assert c.delete(f"/api/v1/expenses/{created['id']}").status_code == 204
    assert c.get("/api/v1/costs?from=2026-11-01&to=2026-11-30").json()["expenses"] == []
