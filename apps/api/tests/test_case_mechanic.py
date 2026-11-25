"""The workshop worker presses «Realizza lavoro» and stays on the case to the end of the job."""
import test_fleet_billing as fleet
from test_staff import worker
from test_users import client  # noqa: F401  (pytest fixture)


def approved_job(c, plate):
    customer = c.post("/api/v1/customers", json={"first_name": "Giulia"}).json()
    vehicle = c.post("/api/v1/vehicles", json={"license_plate": plate, "customer_id": customer["id"]}).json()
    case = c.post("/api/v1/cases", json={"customer_id": customer["id"], "vehicle_id": vehicle["id"], "work_type": "MECHANICAL"}).json()
    estimate = c.post("/api/v1/estimates", json={"repair_case_id": case["id"]}).json()
    c.post(f"/api/v1/estimates/{estimate['id']}/lines", json=fleet.mechanical_line())
    assert c.patch(f"/api/v1/estimates/{estimate['id']}/status", json={"status": "APPROVED"}).status_code == 200
    order = c.post(f"/api/v1/work-orders/from-estimate/{estimate['id']}").json()
    return case, order


def test_worker_takes_the_job_with_realizza_lavoro(client):
    c, _, _ = client
    mechanic, _, mechanic_user = worker(c, "mec-open@example.com", "MECHANIC")
    other, _, other_user = worker(c, "mec-other@example.com", "MECHANIC")
    body, _, _ = worker(c, "carr-open@example.com", "BODYSHOP")

    # A diagnosis alone does not put anybody on the case.
    sent = mechanic.post("/api/v1/diagnoses", json={"license_plate": "GG111GG", "labor_hours": "1"}).json()
    customer = c.post("/api/v1/customers", json={"first_name": "Luca"}).json()
    converted = c.post(f"/api/v1/diagnoses/{sent['id']}/estimate", json={"customer_id": customer["id"]}).json()
    assert c.get(f"/api/v1/cases/{converted['repair_case_id']}").json()["mechanic_id"] is None

    case, order = approved_job(c, "TT222TT")
    job = next(j for j in mechanic.get("/api/v1/my-work").json()["jobs"] if j["work_order_id"] == order["id"])
    assert job["mechanic_id"] is None and job["mine"] is False
    task = job["tasks"][0]
    # Jobs cannot be ticked before somebody takes the case.
    blocked = mechanic.post(f"/api/v1/my-work/tasks/{task['id']}", json={"done": True})
    assert blocked.status_code == 409 and "Realizza lavoro" in blocked.json()["detail"]

    assert body.post(f"/api/v1/my-work/cases/{case['id']}/take").status_code == 403  # other area
    taken = mechanic.post(f"/api/v1/my-work/cases/{case['id']}/take")
    assert taken.status_code == 200 and taken.json()["mechanic_name"] == "Mechanic Test"
    assert mechanic.post(f"/api/v1/my-work/cases/{case['id']}/take").status_code == 200  # pressing again is fine
    busy = other.post(f"/api/v1/my-work/cases/{case['id']}/take")
    assert busy.status_code == 409 and "Mechanic Test" in busy.json()["detail"]

    job = next(j for j in mechanic.get("/api/v1/my-work").json()["jobs"] if j["work_order_id"] == order["id"])
    assert job["mine"] is True and job["mechanic_name"] == "Mechanic Test"
    assert mechanic.post(f"/api/v1/my-work/tasks/{task['id']}", json={"done": True}).status_code == 200
    read = c.get(f"/api/v1/cases/{case['id']}").json()
    assert read["mechanic_id"] == mechanic_user["id"] and read["mechanic_assigned_at"]
    assert next(i for i in c.get("/api/v1/cases").json() if i["id"] == case["id"])["mechanic_name"] == "Mechanic Test"

    # Workers cannot change it; the office can, and only to workshop staff.
    assert other.put(f"/api/v1/cases/{case['id']}/mechanic", json={"mechanic_id": other_user["id"]}).status_code == 403
    admin_id = c.get("/api/v1/me").json()["id"]
    assert c.put(f"/api/v1/cases/{case['id']}/mechanic", json={"mechanic_id": admin_id}).status_code == 422
    technicians = c.get("/api/v1/cases/technicians").json()
    assert {t["id"] for t in technicians} >= {mechanic_user["id"], other_user["id"]}
    moved = c.put(f"/api/v1/cases/{case['id']}/mechanic", json={"mechanic_id": other_user["id"]})
    assert moved.status_code == 200 and moved.json()["mechanic_id"] == other_user["id"]
    assert c.put(f"/api/v1/cases/{case['id']}/mechanic", json={"mechanic_id": None}).json()["mechanic_id"] is None
