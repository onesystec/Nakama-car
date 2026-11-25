from test_staff import worker
from test_users import client  # noqa: F401  (pytest fixture)

PDF = b"%PDF-1.4 carta d'identita"
JPG = b"\xff\xd8\xff\xe0 patente"


def test_worker_fills_profile_and_admin_completes_it(client):
    c, _, _ = client
    mechanic, _, mechanic_user = worker(c, "mec-profilo@example.com", "MECHANIC")
    saved = mechanic.put("/api/v1/me/profile", json={
        "phone": "345 111 2222", "birth_date": "1990-05-01", "birth_place": "Napoli", "tax_code": "rssmra90e01f839x",
        "address": "Via Roma 1", "city": "Milano", "postal_code": "20100", "iban": "it60 x054 2811 1010 0000 0123 456",
        "emergency_contact": "Anna Rossi", "emergency_phone": "333 000 1111",
    })
    assert saved.status_code == 200, saved.text
    profile = saved.json()["profile"]
    assert profile["tax_code"] == "RSSMRA90E01F839X" and profile["iban"] == "IT60X0542811101000000123456"
    assert mechanic.put("/api/v1/me/profile", json={"iban": "IT00X0542811101000000123456"}).status_code == 422
    assert mechanic.put("/api/v1/me/profile", json={"tax_code": "12AB"}).status_code == 422
    assert mechanic.put("/api/v1/me/profile", json={"birth_date": "2999-01-01"}).status_code == 422

    # The administration sees and completes the same sheet; only names of changed fields go to the audit log.
    base = f"/api/v1/users/{mechanic_user['id']}/profile"
    assert c.get(base).json()["profile"]["birth_place"] == "Napoli"
    updated = c.put(base, json={**profile, "address": "Via Milano 5"})
    assert updated.status_code == 200, updated.text
    assert mechanic.get("/api/v1/me").json()["profile"]["address"] == "Via Milano 5"
    assert mechanic.put(base, json={"phone": "1"}).status_code == 403
    audit = c.get("/api/v1/audit")
    assert audit.status_code == 200 and "PROFILE_UPDATED" in audit.text and "Via Milano" not in audit.text


def test_documents_only_for_owner_and_admin(client):
    c, _, _ = client
    mechanic, _, mechanic_user = worker(c, "mec-doc@example.com", "MECHANIC")
    painter, _, painter_user = worker(c, "pitt-doc@example.com", "PAINTER")
    reception, _, _ = worker(c, "acc-doc@example.com", "RECEPTION")

    upload = mechanic.post("/api/v1/me/documents", params={"filename": "carta identità.pdf", "kind": "IDENTITY", "expires_on": "2030-01-01"},
                           content=PDF, headers={"Content-Type": "application/pdf"})
    assert upload.status_code == 201, upload.text
    own = upload.json()
    assert own["kind"] == "IDENTITY" and own["expires_on"] == "2030-01-01" and own["uploaded_by_me"]
    # Wrong or unknown formats are refused.
    assert mechanic.post("/api/v1/me/documents", params={"filename": "x.pdf"}, content=b"<html>", headers={"Content-Type": "application/pdf"}).status_code == 415
    assert mechanic.post("/api/v1/me/documents", params={"filename": "x.html"}, content=b"<html>", headers={"Content-Type": "text/html"}).status_code == 415
    assert mechanic.post("/api/v1/me/documents", params={"filename": "x.pdf", "kind": "SECRET"}, content=PDF, headers={"Content-Type": "application/pdf"}).status_code == 422

    download = mechanic.get(f"/api/v1/me/documents/{own['id']}")
    assert download.status_code == 200 and download.content == PDF and "attachment" in download.headers["content-disposition"]

    # Other workers (even the office reception) never see it; their own list is theirs only.
    assert painter.get("/api/v1/me/documents").json() == []
    assert painter.get(f"/api/v1/me/documents/{own['id']}").status_code == 404
    assert painter.get(f"/api/v1/users/{mechanic_user['id']}/documents").status_code == 403
    assert reception.get(f"/api/v1/users/{mechanic_user['id']}/documents/{own['id']}").status_code == 403

    # The administration sees it and adds the contract.
    base = f"/api/v1/users/{mechanic_user['id']}/documents"
    assert [d["id"] for d in c.get(base).json()] == [own["id"]]
    assert c.get(f"{base}/{own['id']}").content == PDF
    assert c.get(f"/api/v1/users/{painter_user['id']}/documents/{own['id']}").status_code == 404
    contract = c.post(base, params={"filename": "contratto.jpg", "kind": "CONTRACT"}, content=JPG, headers={"Content-Type": "image/jpeg"})
    assert contract.status_code == 201, contract.text
    assert {d["kind"] for d in mechanic.get("/api/v1/me/documents").json()} == {"IDENTITY", "CONTRACT"}

    # The worker cannot delete what the office uploaded, but can delete their own.
    assert mechanic.delete(f"/api/v1/me/documents/{contract.json()['id']}").status_code == 403
    assert mechanic.delete(f"/api/v1/me/documents/{own['id']}").status_code == 204
    assert c.delete(f"{base}/{contract.json()['id']}").status_code == 204
    assert c.get(base).json() == []

    # Documents go with the account.
    c.post(base, params={"filename": "patente.jpg", "kind": "DRIVING_LICENSE"}, content=JPG, headers={"Content-Type": "image/jpeg"})
    assert c.delete(f"/api/v1/users/{mechanic_user['id']}").status_code == 204
