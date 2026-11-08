// Run with: npm test (node --test --experimental-strip-types)
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptLegal, needsLegal, signIn, WRONG_CREDENTIALS, SERVER_ERROR, SERVER_UNREACHABLE } from "./signin.ts";

const API = "https://api.test/api/v1";
const staffSession = { access_token: "staff-token", first_name: "Luca", last_name: "M", tenant_id: "t1", permissions: ["case.read"], roles: ["MECHANIC"], work_area: "MECHANICAL" };

/** Fake API: who exists on each endpoint, and what each endpoint answers. */
function api({ staff = {}, portal = {}, staffStatus, portalStatus, down = false } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push(url.replace(API, ""));
    if (down) throw new TypeError("Failed to fetch");
    const { email, password } = JSON.parse(init.body);
    const isStaff = url.endsWith("/auth/login") && !url.includes("/portal/");
    const forced = isStaff ? staffStatus : portalStatus;
    if (forced) return new Response(forced >= 500 ? "Internal Server Error" : JSON.stringify({ detail: "No tenant membership" }), { status: forced });
    const accounts = isStaff ? staff : portal;
    if (accounts[email] !== password) return new Response(JSON.stringify({ detail: "Invalid credentials" }), { status: 401 });
    return new Response(JSON.stringify(isStaff ? staffSession : { access_token: "portal-token", full_name: "Univex" }), { status: 200 });
  };
  return { fetcher, calls };
}

const accounts = { staff: { "admin@nakamacar.it": "Admin12345!", "meccanico@nakamacar.it": "Mecc123456!" }, portal: { "flotta@univex.it": "Cliente123!" } };

for (const prefer of ["staff", "portal"]) {
  test(`${prefer} page: admin and mechanic get into the workshop`, async () => {
    for (const [email, password] of Object.entries(accounts.staff)) {
      const { fetcher } = api(accounts);
      const result = await signIn(API, email, password, prefer, fetcher);
      assert.equal(result.kind, "staff", email);
      assert.equal(result.session.access_token, "staff-token");
    }
  });

  test(`${prefer} page: customer gets into the portal`, async () => {
    const { fetcher } = api(accounts);
    const result = await signIn(API, "flotta@univex.it", "Cliente123!", prefer, fetcher);
    assert.deepEqual(result, { kind: "portal", token: "portal-token", legalRequired: false });
    assert.equal(needsLegal(result), false);
  });

  test(`${prefer} page: wrong password says so`, async () => {
    const { fetcher, calls } = api(accounts);
    const result = await signIn(API, "admin@nakamacar.it", "wrong", prefer, fetcher);
    assert.deepEqual(result, { kind: "error", message: WRONG_CREDENTIALS });
    assert.equal(calls.length, 2);
  });
}

test("workshop page tries the workshop login first", async () => {
  const { fetcher, calls } = api(accounts);
  await signIn(API, "admin@nakamacar.it", "Admin12345!", "staff", fetcher);
  assert.deepEqual(calls, ["/auth/login"]);
});

test("email typed on a phone with spaces and capitals still works", async () => {
  const { fetcher } = api(accounts);
  const result = await signIn(API, " Admin@NakamaCar.it ", "Admin12345!", "staff", fetcher);
  assert.equal(result.kind, "staff");
});

test("server errors are not reported as a wrong password", async () => {
  assert.deepEqual(await signIn(API, "admin@nakamacar.it", "Admin12345!", "staff", api({ ...accounts, staffStatus: 500 }).fetcher), { kind: "error", message: SERVER_ERROR });
  assert.deepEqual(await signIn(API, "admin@nakamacar.it", "Admin12345!", "staff", api({ down: true }).fetcher), { kind: "error", message: SERVER_UNREACHABLE });
  assert.deepEqual(await signIn(API, "admin@nakamacar.it", "Admin12345!", "staff", api({ ...accounts, staffStatus: 403 }).fetcher), { kind: "error", message: "No tenant membership" });
});

test("accounts that have not accepted terms and privacy are asked, then the acceptance is sent", async () => {
  const sent = [];
  const fetcher = async (url, init) => {
    sent.push({ url: url.replace(API, ""), auth: init.headers.Authorization, body: JSON.parse(init.body) });
    if (url.endsWith("/legal")) return new Response("{}", { status: 200 });
    return new Response(JSON.stringify(url.includes("/portal/") ? { access_token: "portal-token", legal_required: true } : { detail: "Invalid credentials" }), { status: url.includes("/portal/") ? 200 : 401 });
  };
  const result = await signIn(API, "flotta@univex.it", "Cliente123!", "staff", fetcher);
  assert.equal(needsLegal(result), true);
  assert.equal(await acceptLegal(API, result, fetcher), true);
  assert.deepEqual(sent.at(-1), { url: "/portal/legal", auth: "Bearer portal-token", body: { accept_terms: true, accept_privacy: true } });

  const staff = { kind: "staff", session: { ...staffSession, legal_required: true } };
  assert.equal(needsLegal(staff), true);
  await acceptLegal(API, staff, fetcher);
  assert.deepEqual(sent.at(-1).url, "/auth/legal");
  assert.equal(sent.at(-1).auth, "Bearer staff-token");
});

test("worker on a temporary password must choose a new one, which gives a fresh session", async () => {
  const { changeStaffPassword, needsPasswordChange } = await import("./signin.ts");
  const temporary = { kind: "staff", session: { ...staffSession, must_change_password: true } };
  assert.equal(needsPasswordChange(temporary), true);
  assert.equal(needsPasswordChange({ kind: "staff", session: staffSession }), false);
  assert.equal(needsPasswordChange({ kind: "portal", token: "x", legalRequired: false }), false);
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push([url, init.headers.Authorization, JSON.parse(init.body)]);
    const body = JSON.parse(init.body);
    if (body.current_password !== "Temp12345678") return new Response(JSON.stringify({ detail: "La password attuale non è corretta." }), { status: 400 });
    if (body.new_password.length < 10) return new Response("{}", { status: 422 });
    return new Response(JSON.stringify({ ...staffSession, access_token: "new-token", must_change_password: false }), { status: 200 });
  };
  const ok = await changeStaffPassword(API, temporary.session, "Temp12345678", "MyOwnPassword1", fetcher);
  assert.equal(ok.ok, true);
  assert.equal(ok.session.access_token, "new-token");
  assert.deepEqual(seen[0], [`${API}/auth/password`, "Bearer staff-token", { current_password: "Temp12345678", new_password: "MyOwnPassword1" }]);
  assert.deepEqual(await changeStaffPassword(API, temporary.session, "wrong", "MyOwnPassword1", fetcher), { ok: false, message: "La password attuale non è corretta." });
  assert.equal((await changeStaffPassword(API, temporary.session, "Temp12345678", "short", fetcher)).ok, false);
  assert.deepEqual(await changeStaffPassword(API, temporary.session, "a", "b", async () => { throw new TypeError("down"); }), { ok: false, message: SERVER_UNREACHABLE });
});
