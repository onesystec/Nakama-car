from decimal import Decimal
from test_users import client  # noqa: F401  (pytest fixture)

from app.api.v1.estimates import calculate_line
from app.models.estimating import EstimateLineCategory
from app.schemas.estimating import EstimateLineCreate


def test_calculate_line_parts_labor_paint_materials_and_vat():
    payload = EstimateLineCreate(
        category=EstimateLineCategory.BODY_LABOR,
        description="Riparazione paraurti",
        quantity=Decimal("2"),
        unit_price=Decimal("100"),
        discount_percent=Decimal("10"),
        labor_hours=Decimal("2.5"),
        labor_rate=Decimal("45"),
        paint_hours=Decimal("1.5"),
        paint_rate=Decimal("48"),
        materials=Decimal("25"),
        vat_rate=Decimal("22"),
    )

    subtotal, vat, total = calculate_line(payload)

    assert subtotal == Decimal("389.50")
    assert vat == Decimal("85.69")
    assert total == Decimal("475.19")


def test_calculate_line_rounds_money_to_cents():
    payload = EstimateLineCreate(
        category=EstimateLineCategory.PART,
        description="Ricambio",
        quantity=Decimal("1"),
        unit_price=Decimal("33.333"),
        vat_rate=Decimal("22"),
    )

    subtotal, vat, total = calculate_line(payload)

    assert subtotal == Decimal("33.33")
    assert vat == Decimal("7.33")
    assert total == Decimal("40.66")


def test_contract_terms_include_labor_and_mark_up_parts():
    from app.services.pricing import PricingTerms

    payload = EstimateLineCreate(
        category=EstimateLineCategory.MECHANICAL_LABOR,
        description="Tagliando",
        quantity=Decimal("2"),
        unit_price=Decimal("100"),
        discount_percent=Decimal("10"),
        labor_hours=Decimal("2.5"),
        labor_rate=Decimal("45"),
        materials=Decimal("25"),
        vat_rate=Decimal("22"),
    )
    included = PricingTerms(labor_included=True, parts_markup_percent=Decimal("5"))
    assert calculate_line(payload, included) == (Decimal("215.25"), Decimal("47.36"), Decimal("262.61"))
    discounted = PricingTerms(labor_discount_percent=Decimal("20"))
    assert calculate_line(payload, discounted) == (Decimal("295.00"), Decimal("64.90"), Decimal("359.90"))


def test_estimate_lines_keep_the_order_chosen_in_the_editor(client):
    import test_fleet_billing as fleet

    c, _, _ = client
    _, _, _, case = fleet.create_fleet_case(c, plate="OR123DN")
    estimate = c.post("/api/v1/estimates", json={"repair_case_id": case["id"]}).json()
    base = f"/api/v1/estimates/{estimate['id']}"
    ids = [c.post(f"{base}/lines", json=fleet.mechanical_line(description=name)).json()["id"] for name in ("A", "B", "C")]
    assert [line["description"] for line in c.get(f"{base}/lines").json()] == ["A", "B", "C"]

    assert c.put(f"{base}/line-order", json={"line_ids": [ids[2], ids[0], ids[1]]}).status_code == 204
    assert [line["description"] for line in c.get(f"{base}/lines").json()] == ["C", "A", "B"]

    # A new line goes to the end; an incomplete or repeated list is refused.
    c.post(f"{base}/lines", json=fleet.mechanical_line(description="D"))
    assert [line["description"] for line in c.get(f"{base}/lines").json()] == ["C", "A", "B", "D"]
    assert c.put(f"{base}/line-order", json={"line_ids": [ids[0], ids[1]]}).status_code == 422
    assert c.put(f"{base}/line-order", json={"line_ids": [ids[0], ids[0], ids[1], ids[2]]}).status_code == 422


def test_markup_on_part_cost_raises_the_price_but_is_not_shown_to_the_customer(client):
    import test_fleet_billing as fleet

    c, _, _ = client
    _, _, _, case = fleet.create_fleet_case(c, plate="RC123AR")
    estimate = c.post("/api/v1/estimates", json={"repair_case_id": case["id"]}).json()
    base = f"/api/v1/estimates/{estimate['id']}"
    assert c.patch(f"{base}/pricing", json={"apply_contract": False}).status_code == 200  # public price list
    line = c.post(f"{base}/lines", json={
        "category": "PART", "description": "Radiatore", "quantity": 2, "unit_price": 100,
        "markup_percent": 30, "discount_percent": 10, "vat_rate": 22,
    }).json()
    # 2 × 100 € cost, +30% markup, −10% discount = 234 € + 22% VAT.
    assert Decimal(line["line_total"]) == Decimal("285.48")
    assert Decimal(line["markup_percent"]) == Decimal("30")

    preview = c.get(f"{base}/preview").json()
    assert preview["lines"][0]["parts"] == "234.00"
    assert "markup_percent" not in preview["lines"][0] and "unit_price" not in preview["lines"][0]
    assert preview["company"]["name"]
    assert any("Codice SDI" in text for text in preview["company"]["lines"])
    pdf = c.get(f"{base}/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_company_details_fall_back_to_nakama_car():
    from types import SimpleNamespace

    from app.services.company import company_lines, company_profile

    profile = company_profile(None)
    assert profile["company_name"] == "NAKAMA CAR SRLS"
    assert company_lines(profile) == [
        "Via A. Manzoni 58",
        "20900 Monza (MB)",
        "P.IVA 14361530968 · Codice SDI T9K4ZHO",
    ]
    custom = company_profile(SimpleNamespace(company_name="Officina Rossi", address="", vat_number="123", phone="02 1234"))
    assert custom["company_name"] == "Officina Rossi" and custom["vat_number"] == "123"
    assert custom["address"] == "Via A. Manzoni 58" and custom["phone"] == "02 1234"
