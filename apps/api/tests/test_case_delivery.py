"""Delivered vehicles keep their delivery (date, person) and their invoice, and can be found again."""
from test_case_mechanic import approved_job
from test_staff import worker
from test_users import client  # noqa: F401  (pytest fixture)


def invoice_for(c, case):
    estimate = next(e for e in c.get("/api/v1/estimates").json() if e["repair_case_id"] == case["id"])
    return c.post("/api/v1/invoices", json={"estimate_id": estimate["id"]}).json()


def test_delivery_stays_after_the_invoice(client):
    c, _, _ = client
    mechanic, _, _ = worker(c, "mec-del@example.com", "MECHANIC")
    case, order = approved_job(c, "DD111DD")
    assert mechanic.post(f"/api/v1/my-work/cases/{case['id']}/take").status_code == 200
    assert mechanic.get("/api/v1/my-work/delivered").json() == []

    assert c.patch(f"/api/v1/work-orders/{order['id']}/status", json={"status": "DELIVERED"}).status_code == 200
    read = c.get(f"/api/v1/cases/{case['id']}").json()
    assert read["status"] == "DELIVERED" and read["delivered_at"] and read["delivered_by_name"]
    delivered_at = read["delivered_at"]

    invoice = invoice_for(c, case)
    assert c.patch(f"/api/v1/invoices/{invoice['id']}/status", json={"status": "ISSUED"}).status_code == 200
    read = c.get(f"/api/v1/cases/{case['id']}").json()
    assert read["status"] == "INVOICED" and read["delivered_at"] == delivered_at

    rows = c.get("/api/v1/my-work/delivered").json()
    row = next(r for r in rows if r["repair_case_id"] == case["id"])
    assert row["plate"] == "DD111DD" and row["delivered_at"] and row["mechanic_name"] == "Mechanic Test"
    assert row["invoices"][0]["invoice_number"] == invoice["invoice_number"] and row["invoices"][0]["status"] == "ISSUED"
    assert c.get("/api/v1/my-work/delivered?q=DD111").json()[0]["repair_case_id"] == case["id"]
    assert c.get("/api/v1/my-work/delivered?q=ZZ999").json() == []
    # The worker sees the job they did, but not the invoice number.
    worker_row = next(r for r in mechanic.get("/api/v1/my-work/delivered").json() if r["repair_case_id"] == case["id"])
    assert worker_row["invoices"] == [{"status": "ISSUED"}]

    profile = c.get(f"/api/v1/vehicles/{case['vehicle_id']}/profile").json()
    assert profile["history"][0]["delivered_at"] and profile["history"][0]["invoices"][0]["invoice_number"] == invoice["invoice_number"]
    assert next(i for i in c.get("/api/v1/cases").json() if i["id"] == case["id"])["delivered_at"]


def test_invoice_before_delivery_keeps_the_vehicle_in_the_workshop(client):
    c, _, _ = client
    case, order = approved_job(c, "EE222EE")
    invoice = invoice_for(c, case)
    assert c.patch(f"/api/v1/invoices/{invoice['id']}/status", json={"status": "ISSUED"}).status_code == 200
    assert c.get(f"/api/v1/cases/{case['id']}").json()["status"] == "APPROVED"
    assert any(j["work_order_id"] == order["id"] for j in c.get("/api/v1/my-work").json()["jobs"])
    assert c.get("/api/v1/my-work/delivered").json() == []

    assert c.patch(f"/api/v1/work-orders/{order['id']}/status", json={"status": "DELIVERED"}).status_code == 200
    read = c.get(f"/api/v1/cases/{case['id']}").json()
    assert read["status"] == "INVOICED" and read["delivered_at"]

    # Brought back to the workshop by mistake: no longer delivered.
    assert c.patch(f"/api/v1/work-orders/{order['id']}/status", json={"status": "IN_REPAIR"}).status_code == 200
    read = c.get(f"/api/v1/cases/{case['id']}").json()
    assert read["status"] == "IN_REPAIR" and read["delivered_at"] is None


def test_invoices_of_one_case(client):
    c, _, _ = client
    case, _ = approved_job(c, "FF333FF")
    other, _ = approved_job(c, "GG444GG")
    invoice = invoice_for(c, case)
    invoice_for(c, other)
    found = c.get(f"/api/v1/invoices?repair_case_id={case['id']}").json()
    assert [i["id"] for i in found] == [invoice["id"]]
