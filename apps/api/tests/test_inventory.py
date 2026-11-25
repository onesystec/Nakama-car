from decimal import Decimal

from test_costs import make_case
from test_staff import worker
from test_users import client  # noqa: F401  (pytest fixture)


def item(c, **updates):
    response = c.post("/api/v1/inventory/items", json={"area": "MECHANICAL", "name": "Filtro olio", "code": " W712 ", "unit": "PZ",
                                                       "unit_cost": "6.50", "min_quantity": "4", "quantity": "10", **updates})
    assert response.status_code == 201, response.text
    return response.json()


def test_stock_in_out_count_and_value(client):
    c, _, _ = client
    filtro = item(c)
    assert filtro["code"] == "W712" and filtro["quantity"] == "10" and filtro["value"] == "65.00" and not filtro["low"]
    vernice = item(c, area="BODY", category="VERNICE", name="Base opaca nero", unit="L", unit_cost="40", quantity="0", min_quantity="1", code=None)
    assert vernice["low"]  # nothing on the shelf

    # Carico at a different price: average cost.
    moved = c.post(f"/api/v1/inventory/items/{filtro['id']}/movements", json={"kind": "IN", "quantity": "10", "unit_cost": "7.50", "supplier": "Ricambi Roma"})
    assert moved.status_code == 201, moved.text
    assert moved.json()["item"]["quantity"] == "20" and moved.json()["item"]["unit_cost"] == "7.00"

    # Scarico to a pratica keeps the pratica and the plate.
    case = make_case(c, "GH482KL", "MECHANICAL")
    out = c.post(f"/api/v1/inventory/items/{filtro['id']}/movements", json={"kind": "OUT", "quantity": "17", "repair_case_id": case["id"]})
    assert out.status_code == 201, out.text
    assert out.json()["movement"]["plate"] == "GH482KL" and out.json()["movement"]["quantity"] == "-17"
    assert out.json()["item"]["quantity"] == "3" and out.json()["item"]["low"]  # under the minimum of 4
    # Not more than what is on the shelf.
    assert c.post(f"/api/v1/inventory/items/{filtro['id']}/movements", json={"kind": "OUT", "quantity": "5"}).status_code == 409

    # Rettifica: the count says 2.
    count = c.post(f"/api/v1/inventory/items/{filtro['id']}/movements", json={"kind": "ADJUST", "quantity": "2", "note": "Inventario"})
    assert count.json()["item"]["quantity"] == "2" and count.json()["movement"]["quantity"] == "-1"

    data = c.get("/api/v1/inventory").json()
    assert data["can_manage"] and data["area"] is None
    assert data["totals"]["MECHANICAL"] == {"items": 1, "low": 1, "value": "14.00"}
    assert data["totals"]["BODY"]["low"] == 1

    history = c.get(f"/api/v1/inventory/movements?item_id={filtro['id']}").json()
    assert [m["kind"] for m in history][-1] == "IN" and len(history) == 4
    assert [m["note"] for m in history if m["kind"] == "IN"].count("Giacenza iniziale") == 1
    for_case = c.get(f"/api/v1/inventory/movements?repair_case_id={case['id']}").json()
    assert len(for_case) == 1 and for_case[0]["case_number"] == case["case_number"]

    # Undo the rettifica: back to 3.
    undo = c.delete(f"/api/v1/inventory/movements/{history[0]['id']}")
    assert undo.status_code == 204
    assert next(i for i in c.get("/api/v1/inventory").json()["items"] if i["id"] == filtro["id"])["quantity"] == "3"

    # Editing does not touch the quantity.
    edited = c.put(f"/api/v1/inventory/items/{filtro['id']}", json={**filtro, "location": "Scaffale A2", "quantity": "999"})
    assert edited.status_code == 200 and edited.json()["location"] == "Scaffale A2" and edited.json()["quantity"] == "3"

    assert c.delete(f"/api/v1/inventory/items/{filtro['id']}").status_code == 204
    assert [i["name"] for i in c.get("/api/v1/inventory").json()["items"]] == ["Base opaca nero"]


def test_mechanic_sees_and_moves_only_meccanica(client):
    c, _, _ = client
    filtro = item(c)
    vernice = item(c, area="BODY", name="Trasparente", unit="L")
    mechanic, _, _ = worker(c, "mec@example.com", "MECHANIC")
    data = mechanic.get("/api/v1/inventory")
    assert data.status_code == 200, data.text
    assert data.json()["area"] == "MECHANICAL" and not data.json()["can_manage"]
    assert [i["name"] for i in data.json()["items"]] == ["Filtro olio"]
    assert mechanic.post(f"/api/v1/inventory/items/{filtro['id']}/movements", json={"kind": "OUT", "quantity": "1"}).status_code == 201
    assert mechanic.post(f"/api/v1/inventory/items/{vernice['id']}/movements", json={"kind": "OUT", "quantity": "1"}).status_code == 403
    assert mechanic.post("/api/v1/inventory/items", json={"area": "BODY", "name": "Stucco"}).status_code == 403
    assert mechanic.post("/api/v1/inventory/items", json={"area": "MECHANICAL", "name": "Candela"}).status_code == 201
    assert mechanic.delete(f"/api/v1/inventory/items/{filtro['id']}").status_code == 403
    make_case(c, "AB123CD", "MECHANICAL")
    make_case(c, "FT219RX", "BODY")
    assert [row["plate"] for row in mechanic.get("/api/v1/inventory/cases").json()] == ["AB123CD"]
    assert {row["plate"] for row in c.get("/api/v1/inventory/cases").json()} == {"AB123CD", "FT219RX"}


def test_invalid_articles(client):
    c, _, _ = client
    assert c.post("/api/v1/inventory/items", json={"area": "MECHANICAL", "name": "  "}).status_code == 422
    assert c.post("/api/v1/inventory/items", json={"area": "OTHER", "name": "X"}).status_code == 422
    assert c.post("/api/v1/inventory/items", json={"area": "BODY", "name": "X", "category": "NOPE"}).status_code == 422
    created = item(c, quantity="0")
    assert c.post(f"/api/v1/inventory/items/{created['id']}/movements", json={"kind": "IN", "quantity": "0"}).status_code == 422
    assert Decimal(created["value"]) == 0
