from app.services.vehicle_names import short_vehicle_name


def test_long_variant_is_left_out():
    version = "Furgonato Trazione anteriore Iniezione diretta M9T 670;M9T 672;M9T 676 con catalizzatore diesel (Oxi-Kat)"
    assert short_vehicle_name("Renault", "MASTER III Furgonato (FV)", version) == "Renault Master III Furgonato"
    assert short_vehicle_name("RENAULT", "MASTER", version) == "Renault Master"


def test_short_names_unchanged():
    assert short_vehicle_name("Fiat", "Ducato") == "Fiat Ducato"
    assert short_vehicle_name("BMW", "X5 xDrive30d") == "BMW X5 xDrive30d"
    assert short_vehicle_name("MERCEDES-BENZ", "SPRINTER") == "Mercedes-Benz Sprinter"


def test_missing_data():
    assert short_vehicle_name(None, None) is None
    assert short_vehicle_name("Iveco", None, "Daily 35S14 (2014) 2.3 HPT") == "Iveco Daily 35S14"
