"""The workshop worker who opens a repair case stays on it to the end of the job."""
import test_fleet_billing as fleet
from test_staff import worker
from test_users import client  # noqa: F401  (pytest fixture)


def test_diagnosis_author_stays_on_the_case_to_the_end(client):
    c, _, _ = client
    mechanic, _, mechanic_user = worker(c, "mec-open@example.com", "MECHANIC")
    other, _, other_user = worker(c, "mec-other@example.com", "MECHANIC")
    customer = c.post("/api/v1/customers", json={"first_name": "Giulia"}).json()
    vehicle = c.post("/api/v1/vehicles", json={"license_plate": "GG111GG", "customer_id": customer["id"]}).json()

    sent = mechanic.post("/api/v1/diagnoses", json={"license_plate": "GG111GG", "labor_hours": "1"}).json()
    converted = c.post(f"/api/v1/diagnoses/{sent['id']}/estimate", json={}).json()
    case_id = converted["repair_case_id"]
    case = c.get(f"/api/v1/cases/{case_id}").json()
    assert case["mechanic_id"] == mechanic_user["id"] and case["mechanic_name"] == "Mechanic Test" and case["mechanic_assigned_at"]
    listed = next(item for item in c.get("/api/v1/cases").json() if item["id"] == case_id)
    assert listed["mechanic_name"] == "Mechanic Test"

    # Another mechanic diagnosing or ticking jobs later does not take the case over.
    again = other.post("/api/v1/diagnoses", json={"license_plate": "GG111GG", "labor_hours": "1"}).json()
    assert again["repair_case_id"] == case_id
    estimate_id = converted["estimate_id"]
    c.post(f"/api/v1/estimates/{estimate_id}/lines", json=fleet.mechanical_line())
    assert c.patch(f"/api/v1/estimates/{estimate_id}/status", json={"status": "APPROVED"}).status_code == 200
    order = c.post(f"/api/v1/work-orders/from-estimate/{estimate_id}").json()
    task = next(job for job in other.get("/api/v1/my-work").json()["jobs"] if job["work_order_id"] == order["id"])["tasks"][0]
    assert other.post(f"/api/v1/my-work/tasks/{task['id']}", json={"done": True}).status_code == 200
    assert c.get(f"/api/v1/cases/{case_id}").json()["mechanic_id"] == mechanic_user["id"]

    # Workers cannot change it; the office can, and only workshop staff.
    assert other.put(f"/api/v1/cases/{case_id}/mechanic", json={"mechanic_id": other_user["id"]}).status_code == 403
    admin_id = c.get("/api/v1/me").json()["id"]
    assert c.put(f"/api/v1/cases/{case_id}/mechanic", json={"mechanic_id": admin_id}).status_code == 422
    technicians = c.get("/api/v1/cases/technicians").json()
    assert {t["id"] for t in technicians} == {mechanic_user["id"], other_user["id"]}
    assert all(t["area"] == "MECHANICAL" for t in technicians)
    moved = c.put(f"/api/v1/cases/{case_id}/mechanic", json={"mechanic_id": other_user["id"]})
    assert moved.status_code == 200 and moved.json()["mechanic_id"] == other_user["id"]


def test_case_without_diagnosis_gets_first_worker_who_ticks_a_job(client):
    c, _, _ = client
    mechanic, _, mechanic_user = worker(c, "mec-tick@example.com", "MECHANIC")
    customer = c.post("/api/v1/customers", json={"first_name": "Paolo"}).json()
    vehicle = c.post("/api/v1/vehicles", json={"license_plate": "TT222TT", "customer_id": customer["id"]}).json()
    case = c.post("/api/v1/cases", json={"customer_id": customer["id"], "vehicle_id": vehicle["id"], "work_type": "MECHANICAL"}).json()
    assert case["mechanic_id"] is None  # opened by the office: nobody yet
    estimate = c.post("/api/v1/estimates", json={"repair_case_id": case["id"]}).json()
    c.post(f"/api/v1/estimates/{estimate['id']}/lines", json=fleet.mechanical_line())
    c.patch(f"/api/v1/estimates/{estimate['id']}/status", json={"status": "APPROVED"})
    c.post(f"/api/v1/work-orders/from-estimate/{estimate['id']}")
    task = mechanic.get("/api/v1/my-work").json()["jobs"][0]["tasks"][0]
    mechanic.post(f"/api/v1/my-work/tasks/{task['id']}", json={"done": True})
    assert c.get(f"/api/v1/cases/{case['id']}").json()["mechanic_id"] == mechanic_user["id"]

    # The office can also take the worker off the case.
    assert c.put(f"/api/v1/cases/{case['id']}/mechanic", json={"mechanic_id": None}).json()["mechanic_id"] is None
