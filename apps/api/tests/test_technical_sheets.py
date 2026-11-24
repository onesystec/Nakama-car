from test_staff import worker
from test_users import client  # noqa: F401  (pytest fixture)


def make_vehicle(c, plate, **data):
    customer = c.post("/api/v1/customers", json={"customer_type": "PRIVATE", "first_name": "Ada", "last_name": "Neri"}).json()
    response = c.post("/api/v1/vehicles", json={"license_plate": plate, "customer_id": customer["id"], **data})
    assert response.status_code in (200, 201), response.text
    return response.json()


def test_sheet_is_empty_until_the_workshop_fills_it(client):
    c, _, _ = client
    make_vehicle(c, "FM793ZH", make="Fiat", model="Ducato", engine_size="2.3 L", fuel_type="Diesel", power_kw=103)
    sheet = c.get("/api/v1/technical-sheets/vehicle/fm 793 zh").json()
    assert sheet["model_known"] is True and sheet["source"] is None
    assert set(sheet["data"]) == set(sheet["fields"]) and all(value is None for value in sheet["data"].values())
    assert sheet["model_label"] == "Fiat Ducato · 2.3 L Diesel 103 kW"


def test_sheet_is_shared_by_model_and_engine(client):
    c, _, _ = client
    make_vehicle(c, "FM793ZH", make="Fiat", model="Ducato", engine_size="2.3 L", fuel_type="Diesel")
    make_vehicle(c, "GA111BB", make="FIAT", model="ducato", engine_size="2.3 L", fuel_type="Diesel")
    make_vehicle(c, "GA222CC", make="Fiat", model="Ducato", engine_size="2.2 L", fuel_type="Diesel")

    mechanic, _, _ = worker(c, "mec@example.com", "MECHANIC")
    saved = mechanic.put("/api/v1/technical-sheets/vehicle/FM793ZH", json={
        "vin": "zfa25000001234567", "engine_code": "F1AGL411", "data": {"oil_spec": "5W-30 ACEA C2", "oil_capacity": "  ", "oil_filter": "Bosch F 026 407 108"},
    })
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["vehicle"]["vin"] == "ZFA25000001234567" and body["vehicle"]["engine_code"] == "F1AGL411"
    assert body["data"]["oil_spec"] == "5W-30 ACEA C2" and body["data"]["oil_capacity"] is None
    assert body["source"] == "officina" and body["updated_by"] == "Mechanic Test"

    same_model = c.get("/api/v1/technical-sheets/vehicle/GA111BB").json()
    assert same_model["data"]["oil_filter"] == "Bosch F 026 407 108" and same_model["vehicle"]["vin"] is None
    other_engine = c.get("/api/v1/technical-sheets/vehicle/GA222CC").json()
    assert other_engine["data"]["oil_spec"] is None

    assert c.put("/api/v1/technical-sheets/vehicle/FM793ZH", json={"data": {"colour": "red"}}).status_code == 422


def test_sheet_needs_make_and_model(client):
    c, _, _ = client
    make_vehicle(c, "XX123YY")
    assert c.get("/api/v1/technical-sheets/vehicle/XX123YY").json()["model_known"] is False
    refused = c.put("/api/v1/technical-sheets/vehicle/XX123YY", json={"engine_code": "F1AE3481", "data": {"oil_spec": "5W-30"}})
    assert refused.status_code == 422
    only_engine = c.put("/api/v1/technical-sheets/vehicle/XX123YY", json={"engine_code": "F1AE3481"})
    assert only_engine.status_code == 200 and only_engine.json()["vehicle"]["engine_code"] == "F1AE3481"
    assert c.get("/api/v1/technical-sheets/vehicle/ZZ000ZZ").status_code == 404


def photo_b64():
    import base64
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (2400, 1600), "white").save(out, format="PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def test_libretto_reading_is_off_without_api_key(client, monkeypatch):
    from app.core.config import get_settings

    c, _, _ = client
    monkeypatch.setattr(get_settings(), "anthropic_api_key", None)
    assert c.get("/api/v1/technical-sheets/libretto/status").json()["configured"] is False
    refused = c.post("/api/v1/technical-sheets/libretto", json={"image": photo_b64()})
    assert refused.status_code == 503 and "non configurata" in refused.json()["detail"]


def test_libretto_values_are_returned_for_checking_not_saved(client, monkeypatch):
    from app.core.config import get_settings
    from app.services import libretto

    c, _, _ = client
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "test-key")
    monkeypatch.setattr(get_settings(), "libretto_monthly_limit", 2)
    sent = []

    def fake_read(jpeg):
        sent.append(jpeg)
        return {"license_plate": "XX123YY", "make": "FIAT", "model": "DUCATO", "vin": "ZFA25000001234567",
                "engine_size": "2287", "power_kw": "103", "fuel_type": "GASOLIO", "engine_code": "F1AGL411",
                "type_code": None, "registration_date": "12/03/2019"}

    monkeypatch.setattr(libretto, "read_libretto", fake_read)
    make_vehicle(c, "XX123YY")
    read = c.post("/api/v1/technical-sheets/libretto", json={"image": photo_b64()})
    assert read.status_code == 200, read.text
    assert read.json()["values"]["vin"] == "ZFA25000001234567"
    from PIL import Image
    import io
    assert max(Image.open(io.BytesIO(sent[0])).size) == libretto.MAX_SIDE  # downscaled before sending
    assert c.get("/api/v1/technical-sheets/vehicle/XX123YY").json()["vehicle"]["vin"] is None  # nothing saved

    # The workshop confirms: empty vehicle fields are filled, so the sheet gets a model.
    saved = c.put("/api/v1/technical-sheets/vehicle/XX123YY", json={
        "vin": "ZFA25000001234567", "engine_code": "F1AGL411", "make": "FIAT", "model": "DUCATO",
        "engine_size": "2287", "power_kw": 103, "fuel_type": "GASOLIO"}).json()
    assert saved["model_known"] is True and saved["vehicle"]["make"] == "FIAT"

    # Values already on the vehicle (from the plate lookup) are not overwritten.
    make_vehicle(c, "GA111BB", make="Fiat", model="Ducato")
    kept = c.put("/api/v1/technical-sheets/vehicle/GA111BB", json={"make": "IVECO", "model": "DAILY"}).json()
    assert kept["vehicle"]["make"] == "Fiat"

    assert c.post("/api/v1/technical-sheets/libretto", json={"image": photo_b64()}).status_code == 200
    limited = c.post("/api/v1/technical-sheets/libretto", json={"image": photo_b64()})
    assert limited.status_code == 429


def test_libretto_errors_reach_the_workshop(client, monkeypatch):
    from app.core.config import get_settings
    from app.services import libretto

    c, _, _ = client
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "test-key")

    def not_a_libretto(jpeg):
        raise libretto.LibrettoError("La foto non sembra una carta di circolazione: inquadra il libretto aperto.", 422)

    monkeypatch.setattr(libretto, "read_libretto", not_a_libretto)
    answer = c.post("/api/v1/technical-sheets/libretto", json={"image": photo_b64()})
    assert answer.status_code == 422 and "carta di circolazione" in answer.json()["detail"]
    broken = c.post("/api/v1/technical-sheets/libretto", json={"image": "data:image/png;base64," + "A" * 200})
    assert broken.status_code == 422
