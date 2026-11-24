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
