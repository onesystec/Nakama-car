from datetime import date, timedelta

import test_fleet_billing as fleet
import test_tracking as tracking_tests
from test_users import client  # noqa: F401  (pytest fixture)


def test_fleet_portal_login_vehicles_maintenance_and_chat(client):
    c, _, _ = client
    customer, _, vehicle, case = fleet.create_fleet_case(c)
    order = tracking_tests.open_work_order(c, case)
    c.patch(f"/api/v1/work-orders/{order['id']}/status", json={"status": "IN_REPAIR"})

    created = c.post(f"/api/v1/customers/{customer['id']}/portal-accounts", json={"email": "Flotta@Univex.example.com", "full_name": "Ufficio flotta"})
    assert created.status_code == 201, created.text
    account = created.json()
    temporary = account["temporary_password"]
    assert len(temporary) == 12 and account["email"] == "flotta@univex.example.com"
    assert c.post(f"/api/v1/customers/{customer['id']}/portal-accounts", json={"email": "flotta@univex.example.com", "full_name": "Altro"}).status_code == 409
    assert "temporary_password" not in c.get(f"/api/v1/customers/{customer['id']}/portal-accounts").json()[0]

    last = date.today() - timedelta(days=350)
    plan = c.patch(f"/api/v1/vehicles/{vehicle['id']}/maintenance", json={
        "mileage": 118500, "service_interval_km": 20000, "service_interval_months": 12,
        "last_service_date": last.isoformat(), "last_service_km": 100000,
    })
    assert plan.status_code == 200, plan.text
    assert plan.json()["maintenance"]["km_left"] == 1500
    assert plan.json()["maintenance"]["state"] == "SOON"

    portal = c.__class__(c.app)
    assert portal.post("/api/v1/portal/auth/login", json={"email": "flotta@univex.example.com", "password": "wrong"}).status_code == 401
    login = portal.post("/api/v1/portal/auth/login", json={"email": "FLOTTA@univex.example.com", "password": temporary})
    assert login.status_code == 200, login.text
    assert login.json()["must_change_password"] is True
    portal.headers["Authorization"] = "Bearer " + login.json()["access_token"]

    # A portal token never opens the workshop API.
    assert portal.get("/api/v1/cases").status_code == 401
    assert c.get("/api/v1/portal/me").status_code == 401

    me = portal.get("/api/v1/portal/me").json()
    assert me["customer_name"] == "Univex Group" and me["contract"]["name"] == "Manutenzione flotta Univex"

    # No data before the current terms are accepted and the temporary password replaced (the API says so,
    # not only the web page).
    assert portal.get("/api/v1/portal/vehicles").status_code == 401
    assert portal.post("/api/v1/portal/legal", json={"accept_terms": True, "accept_privacy": True}).status_code == 200
    blocked = portal.get("/api/v1/portal/vehicles")
    assert blocked.status_code == 403 and blocked.json()["detail"] == "PASSWORD_CHANGE_REQUIRED"
    changed = portal.post("/api/v1/portal/password", json={"current_password": temporary, "new_password": "NuovaPassword2026"})
    assert changed.status_code == 200
    assert portal.get("/api/v1/portal/me").status_code == 401  # old session revoked
    portal.headers["Authorization"] = "Bearer " + changed.json()["access_token"]
    assert portal.get("/api/v1/portal/me").json()["must_change_password"] is False

    vehicles = portal.get("/api/v1/portal/vehicles").json()
    assert len(vehicles) == 1
    assert vehicles[0]["current_case"]["case_number"] == case["case_number"]
    assert vehicles[0]["current_case"]["status_text"] == "Riparazione in corso"
    assert vehicles[0]["maintenance"]["next_service_km"] == 120000
    detail = portal.get(f"/api/v1/portal/vehicles/{vehicle['id']}").json()
    assert detail["history"][0]["tasks"]

    sent = portal.post(f"/api/v1/portal/cases/{case['id']}/messages", json={"body": "Serve il mezzo entro venerdì"})
    assert sent.status_code == 201 and sent.json()["author_name"] == "Ufficio flotta"
    assert c.get("/api/v1/messages/unread").json()[0]["unread"] == 1
    c.post(f"/api/v1/cases/{case['id']}/messages", json={"body": "Pronto giovedì"})
    assert portal.get("/api/v1/portal/me").json()["unread"] == 1
    assert len(portal.get(f"/api/v1/portal/cases/{case['id']}/messages").json()) == 2

    # Other customers' data stays hidden.
    other = c.post("/api/v1/customers", json={"first_name": "Mario", "last_name": "Rossi"}).json()
    other_vehicle = c.post("/api/v1/vehicles", json={"license_plate": "ZZ999ZZ", "customer_id": other["id"]}).json()
    other_case = c.post("/api/v1/cases", json={"customer_id": other["id"], "vehicle_id": other_vehicle["id"]}).json()
    assert portal.get(f"/api/v1/portal/vehicles/{other_vehicle['id']}").status_code == 404
    assert portal.get(f"/api/v1/portal/cases/{other_case['id']}/messages").status_code == 404

    assert c.patch(f"/api/v1/portal-accounts/{account['id']}", json={"active": False}).json()["active"] is False
    assert portal.get("/api/v1/portal/me").status_code == 401
    assert portal.post("/api/v1/portal/auth/login", json={"email": "flotta@univex.example.com", "password": "NuovaPassword2026"}).status_code == 401


def ready_portal(c, account):
    """A customer's first entry, as the app does it: login, both boxes, own password instead of the temporary one."""
    portal = c.__class__(c.app)
    login = portal.post("/api/v1/portal/auth/login", json={"email": account["email"], "password": account["temporary_password"]})
    portal.headers["Authorization"] = "Bearer " + login.json()["access_token"]
    assert portal.post("/api/v1/portal/legal", json={"accept_terms": True, "accept_privacy": True}).status_code == 200
    changed = portal.post("/api/v1/portal/password", json={"current_password": account["temporary_password"], "new_password": "PasswordCliente2026"})
    portal.headers["Authorization"] = "Bearer " + changed.json()["access_token"]
    return portal


def portal_client(c, customer):
    email = f"menu-{customer['id'][:8]}@example.com"
    account = c.post(f"/api/v1/customers/{customer['id']}/portal-accounts", json={"email": email, "full_name": "Ufficio flotta"}).json()
    return ready_portal(c, account)


def test_portal_menu_sections_and_customer_adds_vehicles(client):
    c, _, _ = client
    customer, contract, vehicle, case = fleet.create_fleet_case(c)
    portal = portal_client(c, customer)

    # Estimates appear once sent; drafts stay with the workshop.
    estimate = c.post("/api/v1/estimates", json={"repair_case_id": case["id"]}).json()
    c.post(f"/api/v1/estimates/{estimate['id']}/lines", json=fleet.mechanical_line())
    assert portal.get("/api/v1/portal/estimates").json() == []
    assert c.patch(f"/api/v1/estimates/{estimate['id']}/status", json={"status": "SENT"}).status_code == 200
    estimates = portal.get("/api/v1/portal/estimates").json()
    assert estimates[0]["estimate_number"] == estimate["estimate_number"] and estimates[0]["license_plate"] == "FL123TR"

    # Only issued invoices, with their PDF.
    fee = c.post(f"/api/v1/contracts/{contract['id']}/fee-invoices", json={"period_month": "2026-10"}).json()
    assert portal.get("/api/v1/portal/invoices").json() == []
    assert portal.get(f"/api/v1/portal/invoices/{fee['id']}/pdf").status_code == 404
    c.patch(f"/api/v1/invoices/{fee['id']}/status", json={"status": "ISSUED"})
    invoices = portal.get("/api/v1/portal/invoices").json()
    assert invoices[0]["invoice_number"] == fee["invoice_number"] and invoices[0]["status"] == "ISSUED"
    pdf = portal.get(f"/api/v1/portal/invoices/{fee['id']}/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"

    # One chat per open repair, with the workshop's unread messages.
    c.post(f"/api/v1/cases/{case['id']}/messages", json={"body": "Mezzo pronto domani"})
    chats = portal.get("/api/v1/portal/conversations").json()
    assert chats[0]["case_id"] == case["id"] and chats[0]["unread"] == 1
    assert chats[0]["last_message"]["body"] == "Mezzo pronto domani"

    # The customer adds a vehicle; existing plates are never taken over.
    added = portal.post("/api/v1/portal/vehicles", json={"license_plate": " gh 123 kk ", "make": "Fiat", "model": "Ducato", "fleet_number": "U-18"})
    assert added.status_code == 201, added.text
    assert added.json()["license_plate"] == "GH 123 KK"
    assert len(portal.get("/api/v1/portal/vehicles").json()) == 2
    assert portal.post("/api/v1/portal/vehicles", json={"license_plate": "GH123KK"}).status_code == 409
    assert portal.post("/api/v1/portal/vehicles", json={"license_plate": "fl-123-tr"}).status_code == 409
    assert portal.post("/api/v1/portal/vehicles", json={"license_plate": "AB"}).status_code == 422
    # Nothing lets the customer edit or delete vehicles.
    assert portal.delete(f"/api/v1/portal/vehicles/{vehicle['id']}").status_code == 405
    assert portal.patch(f"/api/v1/vehicles/{vehicle['id']}/maintenance", json={"mileage": 1}).status_code == 401

    # Another customer sees none of it.
    other = c.post("/api/v1/customers", json={"first_name": "Mario", "last_name": "Rossi"}).json()
    stranger = portal_client(c, other)
    assert stranger.get("/api/v1/portal/estimates").json() == []
    assert stranger.get("/api/v1/portal/invoices").json() == []
    assert stranger.get("/api/v1/portal/conversations").json() == []
    assert stranger.get(f"/api/v1/portal/invoices/{fee['id']}/pdf").status_code == 404


def test_portal_profile_edits_contact_data_but_not_tax_data(client):
    c, _, _ = client
    customer, _, _, _ = fleet.create_fleet_case(c)
    portal = portal_client(c, customer)

    profile = portal.get("/api/v1/portal/profile").json()
    assert profile["customer"]["company_name"] == "Univex Group" and profile["customer"]["vat_number"] == "IT01234567890"
    assert profile["account"]["full_name"] == "Ufficio flotta"

    updated = portal.patch("/api/v1/portal/profile", json={
        "full_name": "Laura Bianchi", "phone": " 333 1234567 ", "email": "Flotta@Univex.it", "city": "Bergamo", "province": "bg", "address": "",
        "company_name": "Altro nome", "vat_number": "IT99999999999",
    })
    assert updated.status_code == 200, updated.text
    data = updated.json()
    assert data["account"]["full_name"] == "Laura Bianchi"
    assert data["customer"]["phone"] == "333 1234567" and data["customer"]["email"] == "flotta@univex.it"
    assert data["customer"]["province"] == "BG" and data["customer"]["address"] is None
    # Tax data is ignored: only the workshop changes it.
    assert data["customer"]["company_name"] == "Univex Group" and data["customer"]["vat_number"] == "IT01234567890"
    staff_view = c.get(f"/api/v1/customers/{customer['id']}").json()
    assert staff_view["city"] == "Bergamo" and staff_view["vat_number"] == "IT01234567890"

    assert portal.patch("/api/v1/portal/profile", json={"email": "non-una-email"}).status_code == 422
    assert portal.patch("/api/v1/portal/profile", json={"full_name": "  "}).status_code == 422
    assert c.get("/api/v1/portal/profile").status_code == 401


def test_portal_vehicle_profile_holds_jobs_estimates_and_invoices(client):
    c, _, _ = client
    customer, contract, vehicle, case = fleet.create_fleet_case(c)
    order = tracking_tests.open_work_order(c, case)
    c.patch(f"/api/v1/work-orders/{order['id']}/status", json={"status": "IN_REPAIR"})
    estimate = c.post("/api/v1/estimates", json={"repair_case_id": case["id"]}).json()
    c.post(f"/api/v1/estimates/{estimate['id']}/lines", json=fleet.mechanical_line())
    c.patch(f"/api/v1/estimates/{estimate['id']}/status", json={"status": "SENT"})
    invoice = c.post("/api/v1/invoices", json={"estimate_id": estimate["id"]}).json()
    portal = portal_client(c, customer)

    detail = portal.get(f"/api/v1/portal/vehicles/{vehicle['id']}").json()
    assert detail["todo"] and detail["todo"][0]["case_number"] == case["case_number"]
    assert detail["in_workshop"] is True and detail["done_total"] == 0
    assert detail["history"][0]["kind"] in ("REPAIR", "MAINTENANCE")
    assert detail["history"][0]["estimate"]["estimate_number"]
    # Draft invoices stay with the workshop; issued ones join the vehicle's profile.
    assert detail["invoices"] == []
    c.patch(f"/api/v1/invoices/{invoice['id']}/status", json={"status": "ISSUED"})
    invoices = portal.get(f"/api/v1/portal/vehicles/{vehicle['id']}").json()["invoices"]
    assert invoices[0]["invoice_number"] == invoice["invoice_number"] and invoices[0]["case_number"] == case["case_number"]



def test_portal_service_requests_are_scoped_and_visible_to_staff(client):
    c, _, _ = client
    customer, _, vehicle, _ = fleet.create_fleet_case(c)
    portal = portal_client(c, customer)
    other = c.post("/api/v1/customers", json={"first_name": "Mario", "last_name": "Rossi"}).json()
    stranger = portal_client(c, other)
    vehicle_url = f"/api/v1/portal/vehicles/{vehicle['id']}/service-requests"
    staff_url = f"/api/v1/customers/{customer['id']}/service-requests"

    assert stranger.get(vehicle_url).status_code == 404
    assert stranger.post(vehicle_url, json={"kind": "ONE_TRACK"}).status_code == 404
    assert portal.post(vehicle_url, json={"kind": "MAINTENANCE", "note": "  "}).status_code == 422
    maintenance = portal.post(vehicle_url, json={"kind": "MAINTENANCE", "note": "Tagliando"})
    assert maintenance.status_code == 201, maintenance.text
    request = maintenance.json()
    gps = portal.post(vehicle_url, json={"kind": "ONE_TRACK"})
    assert gps.status_code == 201, gps.text
    gps_request = gps.json()
    assert portal.post(vehicle_url, json={"kind": "ONE_TRACK"}).status_code == 409
    assert portal.get(staff_url).status_code == 401
    assert {entry["id"] for entry in c.get(staff_url).json()} == {request["id"], gps_request["id"]}
    assert c.get(f"/api/v1/customers/{other['id']}/service-requests").json() == []
    assert c.patch(f"/api/v1/customers/{other['id']}/service-requests/{request['id']}").status_code == 404

    handled = c.patch(f"{staff_url}/{request['id']}")
    assert handled.status_code == 200, handled.text
    assert handled.json()["handled_at"] is not None
    assert c.patch(f"{staff_url}/{request['id']}").json() == handled.json()
    entries = {entry["id"]: entry for entry in portal.get(vehicle_url).json()}
    assert entries[request["id"]]["handled_at"] == handled.json()["handled_at"]
    assert entries[gps_request["id"]]["handled_at"] is None



def test_portal_invitation_and_suspension(client):
    c, _, _ = client
    customer, _, _, _ = fleet.create_fleet_case(c)
    other = c.post("/api/v1/customers", json={"first_name": "Another", "last_name": "Customer"}).json()
    email = "invited@example.com"
    path = f"/api/v1/customers/{customer['id']}/portal-invitations"
    first = c.post(path, json={"email": email})
    assert first.status_code == 201
    assert c.post(f"/api/v1/customers/{other['id']}/portal-invitations", json={"email": email}).status_code == 409
    second = c.post(path, json={"email": email})
    assert second.status_code == 201
    token = second.json()["token"]
    assert token != first.json()["token"]
    public = c.__class__(c.app)
    register = "/api/v1/portal/invitations/register"
    data = {"token": token, "full_name": "Fleet contact", "password": "example-long-password"}
    assert public.post(register, json={**data, "token": first.json()["token"]}).status_code == 404
    assert public.post("/api/v1/portal/invitations/preview", json={"token": token}).json()["email"] == email
    accounts_url = f"/api/v1/customers/{customer['id']}/portal-accounts"
    account = c.get(accounts_url).json()[0]
    account_url = f"/api/v1/portal-accounts/{account['id']}"
    assert c.patch(account_url, json={"active": True}).status_code == 409
    assert "invitation_digest" not in account
    assert public.post(register, json=data).status_code == 201
    assert public.post(register, json=data).status_code == 404
    login_url = "/api/v1/portal/auth/login"
    credentials = {"email": email, "password": data["password"]}
    session = public.post(login_url, json=credentials)
    assert session.status_code == 200
    bearer = {"Authorization": "Bearer " + session.json()["access_token"]}
    assert public.post("/api/v1/portal/legal", headers=bearer, json={"accept_terms": True, "accept_privacy": True}).status_code == 200
    assert public.get("/api/v1/portal/vehicles", headers=bearer).status_code == 200
    suspended = c.patch(account_url, json={"active": False, "suspension_reason": "Pagamento in sospeso"})
    assert suspended.status_code == 200 and suspended.json()["suspension_reason"] == "Pagamento in sospeso"
    assert public.get("/api/v1/portal/vehicles", headers=bearer).status_code == 401
    assert public.post(login_url, json=credentials).status_code == 401
    assert c.patch(account_url, json={"active": True}).json()["suspension_reason"] is None
    assert public.get("/api/v1/portal/vehicles", headers=bearer).status_code == 401
    assert public.post(login_url, json=credentials).status_code == 200



def test_invite_without_email_populates_existing_company(client):
    c, _, _ = client
    customer, _, _, _ = fleet.create_fleet_case(c)
    path = f"/api/v1/customers/{customer['id']}"
    issued = c.post(path + "/portal-invitations", json={})
    assert issued.status_code == 201
    public = c.__class__(c.app)
    token = issued.json()["token"]
    preview = public.post("/api/v1/portal/invitations/preview", json={"token": token})
    assert preview.json() == {"email": None, "customer_type": "COMPANY", "customer_name": None}
    profile = {
        "first_name": "Fleet", "last_name": "Contact", "company_name": "Univex Group",
        "vat_number": "IT12345678901", "tax_code": "12345678901", "phone": "0212345678",
        "address": "Via Roma 1", "postal_code": "20100", "city": "Milano",
        "province": "mi", "country": "it", "pec": "registered@example.com", "sdi": "abc1234",
    }
    data = {"token": token, "full_name": "Fleet Contact", "email": "fleet-intake@example.com",
            "password": "example-long-password", "profile": profile}
    endpoint = "/api/v1/portal/invitations/register"
    assert public.post(endpoint, json={**data, "profile": None}).status_code == 422
    response = public.post(endpoint, json=data)
    assert response.status_code == 201, response.text
    updated = c.get(path).json()
    assert updated["id"] == customer["id"]
    for key, value in {**profile, "email": data["email"], "vat_number": "12345678901",
                       "country": "IT", "province": "MI", "sdi": "ABC1234"}.items():
        assert updated[key] == value
    assert public.post(endpoint, json=data).status_code == 404


def test_invite_without_email_lets_client_register_as_private(client):
    c, _, _ = client
    customer, _, _, _ = fleet.create_fleet_case(c)
    path = f"/api/v1/customers/{customer['id']}"
    token = c.post(path + "/portal-invitations", json={}).json()["token"]
    public = c.__class__(c.app)
    profile = {
        "customer_type": "PRIVATE", "first_name": "Maria", "last_name": "Rossi",
        "tax_code": "rssmra80a41f205x", "phone": "3331234567", "address": "Via Verdi 2",
        "postal_code": "20100", "city": "Milano", "province": "MI", "country": "IT",
    }
    response = public.post("/api/v1/portal/invitations/register", json={
        "token": token, "full_name": "Maria Rossi", "email": "maria@example.com",
        "password": "example-long-password", "profile": profile,
    })
    assert response.status_code == 201, response.text
    updated = c.get(path).json()
    assert updated["customer_type"] == "PRIVATE"
    assert updated["company_name"] is None and updated["vat_number"] is None
    assert (updated["first_name"], updated["tax_code"]) == ("Maria", "RSSMRA80A41F205X")


def test_company_registers_without_codice_fiscale_but_private_needs_it(client):
    c, _, _ = client
    customer, _, _, _ = fleet.create_fleet_case(c)
    path = f"/api/v1/customers/{customer['id']}"
    public = c.__class__(c.app)
    endpoint = "/api/v1/portal/invitations/register"
    base = {
        "first_name": "Luca", "last_name": "Verdi", "phone": "3331234567", "address": "Via Roma 1",
        "postal_code": "20100", "city": "Milano", "province": "MI", "country": "IT",
    }
    token = c.post(path + "/portal-invitations", json={}).json()["token"]
    private = {**base, "customer_type": "PRIVATE"}
    data = {"token": token, "full_name": "Luca Verdi", "email": "luca@example.com", "password": "example-long-password"}
    assert public.post(endpoint, json={**data, "profile": private}).status_code == 422
    company = {**base, "customer_type": "COMPANY", "company_name": "Gamonal Trasporti", "vat_number": "14345540968"}
    response = public.post(endpoint, json={**data, "profile": company})
    assert response.status_code == 201, response.text
    assert c.get(path).json()["vat_number"] == "14345540968"



def test_portal_excel_import_uses_plate_data_and_leaves_mileage_blank(client, monkeypatch):
    from fastapi import HTTPException
    from app.api.v1 import portal as portal_routes
    from app.schemas.garage import PlateLookupResult

    c, _, _ = client
    customer, _, vehicle, _ = fleet.create_fleet_case(c)
    portal = portal_client(c, customer)
    calls = []

    def lookup(db, tenant_id, plate, *, cached_only=False):
        calls.append((plate, cached_only))
        if plate == "AB123CD":
            return PlateLookupResult(license_plate=plate, make="Fiat", model="Ducato", year=2021,
                                     fuel_type="Diesel", doors=4, source="test", cached=cached_only)
        raise HTTPException(status_code=404, detail="Plate not found")

    monkeypatch.setattr(portal_routes, "resolve_plate_data", lookup)
    path = "/api/v1/portal/vehicle-import"
    file = f"Targa;N. flotta;Km\nAB-123-CD;F-1;99999\nAB123CD;;\nEF456GH;;\n{vehicle['license_plate']};;".encode()
    preview = portal.post(path, params={"filename": "fleet.csv"}, content=file)
    assert [row["status"] for row in preview.json()["rows"]] == ["pending", "duplicate", "pending", "existing"]
    assert not calls
    assert portal.get(path + "/plate/AB123CD").json()["model"] == "Ducato"
    assert portal.get(path + "/plate/" + vehicle["license_plate"]).status_code == 409
    result = portal.post(path, params={"filename": "fleet.csv", "preview": "false"}, content=file)
    assert result.json()["created"] == 2
    assert calls == [("AB123CD", False), ("AB123CD", True), ("EF456GH", True)]
    vehicles = {row["license_plate"]: row for row in portal.get("/api/v1/portal/vehicles").json()}
    assert vehicles["AB123CD"]["make"] == "Fiat"
    assert vehicles["AB123CD"]["mileage"] is None
    assert vehicles["EF456GH"]["mileage"] is None
    assert portal.post(path, params={"filename": "fleet.csv", "preview": "false"}, content=file).json()["created"] == 0


def test_portal_cases_and_workshop_scene_show_only_own_vehicles(client):
    c, _, _ = client
    customer, _, vehicle, case = fleet.create_fleet_case(c)
    portal = portal_client(c, customer)

    # A second vehicle of the same customer, already ready for pickup: listed among the cases, not in the 3D workshop.
    ready_vehicle = c.post("/api/v1/vehicles", json={"license_plate": "RD456YY", "customer_id": customer["id"]}).json()
    ready_case = c.post("/api/v1/cases", json={"customer_id": customer["id"], "vehicle_id": ready_vehicle["id"]}).json()
    order = tracking_tests.open_work_order(c, ready_case)
    assert c.patch(f"/api/v1/work-orders/{order['id']}/status", json={"status": "READY"}).status_code == 200

    # Another customer of the workshop, with a car in repair: never visible.
    other = c.post("/api/v1/customers", json={"first_name": "Mario", "last_name": "Rossi"}).json()
    other_vehicle = c.post("/api/v1/vehicles", json={"license_plate": "ZZ999ZZ", "customer_id": other["id"]}).json()
    other_case = c.post("/api/v1/cases", json={"customer_id": other["id"], "vehicle_id": other_vehicle["id"]}).json()
    other_order = tracking_tests.open_work_order(c, other_case)
    c.patch(f"/api/v1/work-orders/{other_order['id']}/status", json={"status": "IN_REPAIR"})

    cases = portal.get("/api/v1/portal/cases")
    assert cases.status_code == 200, cases.text
    numbers = {item["case_number"]: item for item in cases.json()}
    assert set(numbers) == {case["case_number"], ready_case["case_number"]}
    assert numbers[case["case_number"]]["license_plate"] == "FL123TR"
    assert numbers[case["case_number"]]["status_text"] == "Veicolo accettato in officina"
    assert numbers[ready_case["case_number"]]["status"] == "READY"
    assert numbers[ready_case["case_number"]]["estimate"]["status"] == "APPROVED"

    scene = portal.get("/api/v1/portal/workshop-scene")
    assert scene.status_code == 200, scene.text
    plates = [item["plate"] for item in scene.json()["vehicles"]]
    assert plates == ["FL123TR"]
    assert "events" not in scene.json()

    # Once in repair it stays in the scene; delivered, it leaves.
    first_order = tracking_tests.open_work_order(c, case)
    c.patch(f"/api/v1/work-orders/{first_order['id']}/status", json={"status": "IN_REPAIR"})
    assert [item["status"] for item in portal.get("/api/v1/portal/workshop-scene").json()["vehicles"]] == ["IN_REPAIR"]

    # Workshop staff tokens do not open the portal endpoints, nor the other way round.
    assert c.get("/api/v1/portal/cases").status_code == 401
    assert c.get("/api/v1/portal/workshop-scene").status_code == 401
    assert portal.get("/api/v1/workshop-scene").status_code == 401
