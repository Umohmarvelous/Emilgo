// v8 (A8): the advertiser portal, served by the game server itself at /advertise, so it's reachable wherever the
// game is (it used to live on the EMILGO app's site, which isn't deployed: "the portal can't be reached").
//
// One page, no build step: sign in or sign up (an email and a password, with the EMILGO Supabase project's own
// sign-in, so the advertiser's account is theirs and never a Lagos Life player's), make an ad (a picture, a headline,
// a link, the rules confirmed), pick a numbered billboard for 1 or 2 weeks, pay through this server's checkout
// (billing.ts → checkout.ts), and see your ads and their review. Everything that decides anything stays in the
// database (the review, the price, the board being free). Never shown in Lagos Life (Agreement 4(g)).
//
// While the owner's switch is off (switches.ts) the page says billboards aren't open yet, and books nothing.

export interface PortalConfig {
  on: boolean;
  /** The ad stack (public values), or null when this server has none. */
  sb: { url: string; anon: string } | null;
  provider: string;
  live: boolean;
}

/** The rules every ad is checked against (the app's BILLBOARD_RULES: the same ids). */
const RULES: [string, string][] = [
  ["no_gambling", "No gambling: no casinos, lotteries, jackpots or games of chance"],
  ["no_betting", "No betting: no sports betting, odds or wagers"],
  ["no_adult", "Nothing adult or sexual"],
  ["no_crypto", "No crypto, forex, tokens or trading schemes"],
  ["no_scam", "No scams: no promised returns, loan apps or giveaways for money"],
  ["vatar_4h", "Nothing else the Lagos Life developer agreement §4(h) prohibits"],
];

export function portalHtml(cfg: PortalConfig): string {
  // JSON in a script tag: "<" escaped so nothing in it can close the tag.
  const data = JSON.stringify({ ...cfg, rules: RULES }).replace(/</g, "\\u003c");
  return PAGE.replace("__CONFIG__", data);
}

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>LOOTLINE · Advertise</title>
<style>
:root{--bg:#101109;--panel:#1b1c14;--line:#3a3b2c;--ink:#f2e6c9;--dim:#b8b39a;--amber:#ffb23a;--red:#ff6a5a;--green:#8fd18a}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:620px;margin:0 auto;padding:18px 16px 60px}
h1{font:900 22px/1.1 Montserrat,"Arial Black",system-ui,sans-serif;letter-spacing:.02em;margin:4px 0 2px}
h2{font:800 13px/1.2 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);margin:22px 0 8px}
p{margin:6px 0}
.dim{color:var(--dim);font-size:12.5px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:14px;margin:10px 0}
label{display:block;font-size:12px;color:var(--dim);margin:10px 0 4px}
input[type=text],input[type=email],input[type=password],input[type=url],select{width:100%;padding:10px 11px;background:#0c0d08;border:1px solid var(--line);border-radius:4px;color:var(--ink);font:inherit}
button{font:800 13px system-ui,sans-serif;letter-spacing:.06em;padding:11px 16px;border-radius:4px;border:1px solid var(--line);background:#26271c;color:var(--ink);cursor:pointer}
button.go{background:var(--amber);border-color:var(--amber);color:#1a1204}
button:disabled{opacity:.5;cursor:default}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.rule{display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:6px 0}
.rule input{margin-top:3px}
.msg{padding:10px 12px;border-radius:4px;margin:10px 0;font-size:13px;display:none}
.msg.on{display:block}
.msg.err{background:#3a1410;color:#ffc4bb}
.msg.ok{background:#16301a;color:#c9f1c3}
.msg.info{background:#2a2412;color:#ffe0a0}
.boards{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px;max-height:280px;overflow:auto;margin-top:6px}
.board{border:1px solid var(--line);border-radius:4px;padding:8px;cursor:pointer;font-size:12px;background:#0c0d08}
.board b{display:block;font-size:14px}
.board.on{border-color:var(--amber);box-shadow:inset 0 0 0 1px var(--amber)}
.board.busy{opacity:.45}
.ad{display:flex;gap:10px;align-items:center;border-top:1px solid var(--line);padding:8px 0}
.ad img{width:72px;height:40px;object-fit:cover;border-radius:3px;background:#000}
.tag{font:800 10px system-ui;letter-spacing:.1em;text-transform:uppercase;padding:2px 6px;border-radius:3px;background:#2a2b20}
.tag.approved{color:var(--green)} .tag.rejected{color:var(--red)} .tag.pending{color:var(--amber)}
.hide{display:none!important}
</style>
</head>
<body>
<main>
  <div class="dim">LOOTLINE</div>
  <h1>Advertise on our billboards</h1>
  <p class="dim">Your business on the numbered billboards players pass in every match. Book one for 1 or 2 weeks. A person checks every ad before it goes up. We count how long each board was on screen, never who saw it.</p>
  <div id="msg" class="msg"></div>

  <section id="closed" class="card hide"><b>Billboards aren't open yet.</b><p class="dim">Booking opens soon. Please check back later.</p></section>
  <section id="nostack" class="card hide"><b>Billboards aren't set up on this server yet.</b><p class="dim">The ad stack isn't configured here.</p></section>

  <section id="auth" class="card hide">
    <b id="authTitle">Sign in</b>
    <p class="dim">An account for your business: an email and a password. It isn't a game account.</p>
    <label for="email">Email</label><input id="email" type="email" autocomplete="email">
    <label for="pass">Password (8 or more characters)</label><input id="pass" type="password" autocomplete="current-password">
    <div class="row" style="margin-top:12px"><button class="go" id="signin">Sign in</button><button id="signup">Create an account</button></div>
  </section>

  <section id="app" class="hide">
    <div class="row" style="justify-content:space-between"><span class="dim" id="who"></span><button id="signout">Sign out</button></div>

    <section id="biz" class="card hide">
      <b>Your business</b>
      <label for="bizName">Business name</label><input id="bizName" type="text" maxlength="80">
      <div class="row" style="margin-top:12px"><button class="go" id="makeAcct">Continue</button></div>
    </section>

    <div id="main" class="hide">
      <h2>1 · Make your ad</h2>
      <div class="card">
        <label for="headline">Headline</label><input id="headline" type="text" maxlength="60" placeholder="What players read on the board">
        <label for="site">Your website (https://…)</label><input id="site" type="url" placeholder="https://">
        <label for="pic">Picture (JPEG, PNG or WebP, up to 2 MB; wide, about 2:1)</label><input id="pic" type="file" accept="image/jpeg,image/png,image/webp">
        <div id="rules"></div>
        <div class="row" style="margin-top:12px"><button class="go" id="submitAd">Send for review</button></div>
      </div>

      <h2>2 · Book a billboard</h2>
      <div class="card">
        <label for="adPick">Which ad</label><select id="adPick"></select>
        <label>Which billboard (each is numbered with its place)</label>
        <div class="boards" id="boards"></div>
        <label for="weeks">How long</label><select id="weeks"><option value="1">1 week</option><option value="2">2 weeks</option></select>
        <p class="dim" id="price"></p>
        <div class="row" style="margin-top:8px"><button class="go" id="book">Pay and book</button></div>
        <p class="dim" id="payNote"></p>
        <div class="row hide" id="paid"><button id="paidBtn">I've paid: check</button></div>
      </div>

      <h2>Your ads</h2>
      <div class="card" id="mine"><p class="dim">None yet.</p></div>
    </div>
  </section>
</main>
<script>
(function () {
  var C = __CONFIG__;
  var $ = function (id) { return document.getElementById(id); };
  var S = null;
  var boards = [], mine = [], pick = null, lastRef = null;
  var KEY = "lootline.ads.session";

  function show(id, on) { $(id).classList.toggle("hide", !on); }
  function say(text, kind) { var m = $("msg"); m.textContent = text || ""; m.className = "msg" + (text ? " on " + (kind || "info") : ""); }
  function naira(n) { return "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG"); }

  function api(path, opts) {
    opts = opts || {};
    var h = { apikey: C.sb.anon, Authorization: "Bearer " + (S && !opts.anon ? S.access_token : C.sb.anon) };
    if (opts.body !== undefined && !opts.raw) h["Content-Type"] = "application/json";
    if (opts.type) h["Content-Type"] = opts.type;
    return fetch(C.sb.url + path, { method: opts.method || "GET", headers: h, body: opts.raw ? opts.body : opts.body !== undefined ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok) throw new Error((j && (j.msg || j.message || j.error_description || j.error)) || ("Error " + r.status));
        return j;
      }); });
  }
  function rpc(fn, body) { return api("/rest/v1/rpc/" + fn, { method: "POST", body: body || {} }); }
  function server(path, opts) {
    opts = opts || {};
    return fetch(path, { method: opts.method || "GET", headers: Object.assign({ Authorization: "Bearer " + S.access_token }, opts.body ? { "Content-Type": "application/json" } : {}), body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ("Error " + r.status)); return j; }); });
  }

  function keep(s) {
    S = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), email: (s.user && s.user.email) || (S && S.email) || "" } : null;
    try { if (S) localStorage.setItem(KEY, JSON.stringify(S)); else localStorage.removeItem(KEY); } catch (e) {}
  }
  function fresh() {
    if (!S || S.expires_at - 60 > Date.now() / 1000) return Promise.resolve();
    return api("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: S.refresh_token }, anon: true }).then(keep, function () { keep(null); });
  }

  function signIn(up) {
    var email = $("email").value.trim(), pass = $("pass").value;
    if (!/^\S+@\S+\.\S+$/.test(email) || pass.length < 8) return say("Enter your email and a password of 8 or more characters.", "err");
    say(up ? "Creating your account…" : "Signing in…");
    var p = up ? api("/auth/v1/signup", { method: "POST", body: { email: email, password: pass }, anon: true }) : api("/auth/v1/token?grant_type=password", { method: "POST", body: { email: email, password: pass }, anon: true });
    p.then(function (s) {
      if (!s || !s.access_token) { say(up ? "Account created. Check your email to confirm it, then sign in." : "Couldn't sign in.", up ? "ok" : "err"); return; }
      keep(s); say(""); start();
    }, function (e) { say(e.message, "err"); });
  }

  function start() {
    if (!S) { show("auth", true); show("app", false); return; }
    show("auth", false); show("app", true);
    $("who").textContent = S.email ? "Signed in as " + S.email : "Signed in";
    fresh().then(function () {
      if (!S) return start();
      return rpc("my_ad_account", { p_name: null, p_email: null }).then(function (d) {
        var has = d && d.account;
        show("biz", !has); show("main", !!has);
        if (has) return load();
      });
    }).catch(function (e) { say(e.message, "err"); });
  }

  function load() {
    return Promise.all([rpc("billboard_boards"), rpc("my_billboard_ads")]).then(function (r) {
      boards = r[0] || []; mine = r[1] || [];
      drawBoards(); drawMine(); price();
      var q = new URLSearchParams(location.search).get("ref");
      if (q) { history.replaceState(null, "", location.pathname); check(q); }
    });
  }

  function drawBoards() {
    var box = $("boards"); box.innerHTML = "";
    var now = Date.now();
    boards.forEach(function (b) {
      var d = document.createElement("div");
      var busy = b.free_from && new Date(b.free_from).getTime() > now + 60000;
      d.className = "board" + (pick === b.id ? " on" : "") + (busy ? " busy" : "");
      var t = document.createElement("b"); t.textContent = "#" + (b.number != null ? b.number : b.id);
      var l = document.createElement("span"); l.textContent = b.label || "";
      var f = document.createElement("div"); f.className = "dim"; f.textContent = busy ? "Free from " + new Date(b.free_from).toLocaleDateString() : naira(b.week1) + " / week";
      d.append(t, l, f);
      d.onclick = function () { pick = b.id; drawBoards(); price(); };
      box.append(d);
    });
  }

  function drawMine() {
    var box = $("mine"); box.innerHTML = "";
    var sel = $("adPick"); sel.innerHTML = "";
    if (!mine.length) { box.innerHTML = '<p class="dim">None yet. Make one above.</p>'; }
    mine.forEach(function (a) {
      var row = document.createElement("div"); row.className = "ad";
      var info = document.createElement("div"); info.style.flex = "1";
      var h = document.createElement("b"); h.textContent = a.headline;
      var s = document.createElement("div"); s.className = "dim"; s.textContent = (a.active ? "On the air" : "Off the air") + " · " + Number(a.views || 0) + " views" + (a.review_notes ? " · " + a.review_notes : "");
      info.append(h, s);
      var tag = document.createElement("span"); tag.className = "tag " + a.review_status; tag.textContent = a.review_status;
      row.append(info, tag); box.append(row);
      if (a.review_status !== "rejected") { var o = document.createElement("option"); o.value = a.id; o.textContent = a.headline + " (" + a.review_status + ")"; sel.append(o); }
    });
  }

  function price() {
    var b = boards.find(function (x) { return x.id === pick; });
    var w = $("weeks").value === "2" ? 2 : 1;
    $("price").textContent = b ? "Billboard #" + (b.number != null ? b.number : b.id) + " for " + w + (w > 1 ? " weeks: " : " week: ") + naira(w === 2 ? b.week2 : b.week1) + (b.placeholder ? " (test prices)" : "") : "Pick a billboard.";
    $("payNote").textContent = C.live ? "You pay on " + C.provider.charAt(0).toUpperCase() + C.provider.slice(1) + "'s own page, then come back here." : "Test mode: this server has no payment key yet, so no money moves and nothing is booked.";
  }

  function upload(file) {
    if (!file) return Promise.reject(new Error("Pick a picture."));
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Promise.reject(new Error("Pictures must be JPEG, PNG or WebP."));
    if (file.size > 2 * 1024 * 1024) return Promise.reject(new Error("That picture is too large. Keep it under 2 MB."));
    return api("/auth/v1/user").then(function (u) {
      var ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      var path = u.id + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
      return api("/storage/v1/object/ad-media/" + path, { method: "POST", body: file, raw: true, type: file.type }).then(function () {
        return C.sb.url + "/storage/v1/object/public/ad-media/" + path;
      });
    });
  }

  function submitAd() {
    var head = $("headline").value.trim(), site = $("site").value.trim();
    var att = Array.prototype.slice.call(document.querySelectorAll("#rules input:checked")).map(function (x) { return x.value; });
    if (!head) return say("Write a headline.", "err");
    if (!/^https:\/\/\S{3,}/.test(site)) return say("Your website must start with https://", "err");
    if (att.length !== C.rules.length) return say("Confirm every rule.", "err");
    $("submitAd").disabled = true; say("Uploading your picture…");
    fresh().then(function () { return upload($("pic").files[0]); }).then(function (url) {
      return rpc("submit_billboard_ad", { p_headline: head, p_website: site, p_format: "static", p_media_url: url, p_slides: [], p_poster_url: null, p_maps: [], p_slots: [], p_premium: false, p_cycle: 0, p_audio: false, p_starts_at: new Date().toISOString(), p_ends_at: null, p_attest: att });
    }).then(function () {
      say("Sent for review. A person checks every ad before it goes up; the answer shows here.", "ok");
      $("headline").value = ""; $("pic").value = "";
      return load();
    }).catch(function (e) { say(e.message, "err"); }).then(function () { $("submitAd").disabled = false; });
  }

  function book() {
    var ad = $("adPick").value;
    if (!pick) return say("Pick a billboard.", "err");
    if (!ad) return say("Make an ad first: it's what goes on the board.", "err");
    $("book").disabled = true; say("Opening the payment…");
    fresh().then(function () {
      return server("/ads/v1/checkout", { method: "POST", body: { slot_id: pick, weeks: $("weeks").value === "2" ? 2 : 1, creative_id: ad, return_url: location.origin + "/advertise" } });
    }).then(function (c) {
      if (c.checkout_url) {
        // Inside the game's sheet (a frame): payment pages refuse frames, so the checkout opens in a tab of its own.
        if (window.top !== window.self) {
          window.open(c.checkout_url, "_blank", "noopener");
          lastRef = c.reference; show("paid", true);
          say("Pay in the new tab, then come back and tap \u201cI've paid\u201d.", "info");
        } else location.href = c.checkout_url;
        return;
      }
      say("Test mode: no money moved and nothing is booked (this server has no payment key yet).", "info");
    }).catch(function (e) { say(e.message, "err"); }).then(function () { $("book").disabled = false; });
  }

  function check(ref) {
    say("Checking your payment…");
    server("/ads/v1/verify/" + encodeURIComponent(ref)).then(function (r) {
      say(r.ok ? "Paid. Your billboard is booked: it goes up once your ad is approved." : "Not paid yet. If you paid, it can take a minute: refresh this page.", r.ok ? "ok" : "info");
      if (r.ok) load();
    }, function (e) { say(e.message, "err"); });
  }

  // The rules, each confirmed.
  $("rules").innerHTML = "";
  C.rules.forEach(function (r) {
    var l = document.createElement("label"); l.className = "rule";
    var c = document.createElement("input"); c.type = "checkbox"; c.value = r[0];
    var s = document.createElement("span"); s.textContent = r[1];
    l.append(c, s); $("rules").append(l);
  });

  if (!C.on) return show("closed", true);
  if (!C.sb) return show("nostack", true);
  try { S = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { S = null; }
  $("signin").onclick = function () { signIn(false); };
  $("signup").onclick = function () { signIn(true); };
  $("signout").onclick = function () { keep(null); start(); };
  $("makeAcct").onclick = function () {
    var n = $("bizName").value.trim();
    if (n.length < 2) return say("Enter your business name.", "err");
    rpc("my_ad_account", { p_name: n, p_email: S.email || null }).then(function () { say(""); start(); }, function (e) { say(e.message, "err"); });
  };
  $("submitAd").onclick = submitAd;
  $("book").onclick = book;
  $("paidBtn").onclick = function () { if (lastRef) check(lastRef); };
  $("weeks").onchange = price;
  start();
})();
</script>
</body>
</html>`;
