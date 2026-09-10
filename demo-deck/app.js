const HASHSCAN = /https:\/\/hashscan\.io\/[^\s"'<>]+/g;

const PAY_CORE = `// scripts/pay.ts
const res = await pay(url);   // 402 → sign HBAR → retry
console.log(await res.text());`;

const slides = [
  {
    id: "what",
    kicker: "what",
    title: "Fare",
    say: "An API that charges HBAR per request. One call, one payment.",
    points: [],
    run: null,
  },
  {
    id: "tickets",
    kicker: "what you buy",
    title: "Two paid APIs",
    say: "Pay to read a Hedera account, or pay to run a Node script.",
    points: [
      "Read — live balance and transactions",
      "Run — AWS Lambda, you get stdout",
      "50 txs cost 6× a ping. A longer job costs more.",
    ],
    run: null,
  },
  {
    id: "pay",
    kicker: "how it pays",
    title: "Pay first",
    say: "Call without paying and the API refuses. Pay the quoted HBAR, then it returns the data.",
    points: [
      "1. You call the API",
      "2. It answers 402 + a price (cheapest: 0.001 HBAR)",
      "3. You pay that HBAR on Hedera",
      "4. You get the JSON",
    ],
    run: null,
  },
  {
    id: "ping402",
    kicker: "live 1/5",
    title: "Ask without paying",
    say: "No wallet. Watch the terminal: the API refuses.",
    call: "GET /v1/ping",
    points: ["HTTP 402", "price 0.001 HBAR", "no JSON body"],
    run: "ping402",
    runLabel: "curl -si https://fare-production.up.railway.app/v1/ping",
  },
  {
    id: "account",
    kicker: "live 2/5",
    title: "Pay, then read",
    say: "Same API. Now the client pays the quote.",
    call: "GET /v1/accounts/0.0.98",
    core: true,
    points: ["402 then 200", "live balance", "HashScan link"],
    run: "account",
    runLabel: "npx tsx scripts/pay.ts GET /v1/accounts/0.0.98",
  },
  {
    id: "txs",
    kicker: "live 3/5",
    title: "More rows, more HBAR",
    say: "Same account. 50 transactions cost 6× a ping. Wait.",
    call: "GET /v1/accounts/0.0.98/transactions?limit=50",
    core: true,
    points: ["quote 0.006 HBAR", "50 rows in the JSON"],
    run: "txs",
    runLabel: "npx tsx scripts/pay.ts GET '/v1/accounts/0.0.98/transactions?limit=50'",
  },
  {
    id: "job",
    kicker: "live 4/5",
    title: "Pay to run a job",
    say: "Second product. Lambda runs the script.",
    call: "POST /v1/jobs  { script: console.log(1+1) }",
    core: true,
    points: ["quote 0.002 HBAR", "stdout is 2"],
    run: "job",
    runLabel: "npx tsx scripts/pay.ts POST /v1/jobs '{\"script\":\"console.log(1+1)\",\"timeoutSeconds\":10}'",
  },
  {
    id: "hcs",
    kicker: "live 5/5",
    title: "Also on Hedera",
    say: "Each payment is written to this HCS topic.",
    call: "GET topic/0.0.10320508/messages",
    points: ["newest lines include amountTinybars"],
    run: "hcs",
    runLabel: "curl topic 0.0.10320508",
  },
];

const term = document.getElementById("term");
const termState = document.getElementById("termState");
const links = document.getElementById("links");
const hint = document.getElementById("hint");

let index = 0;
let ran = false;
let busy = false;
let abort = null;
let runId = 0;

function setState(name, cls) {
  termState.textContent = name;
  termState.className = `term-state ${cls}`;
}

function renderSlide() {
  const s = slides[index];
  document.getElementById("kicker").textContent = s.kicker;
  document.getElementById("count").textContent = `${index + 1} / ${slides.length}`;
  document.getElementById("title").textContent = s.title;
  document.getElementById("say").textContent = s.say;

  const badge = document.getElementById("badge");
  if (s.badge) {
    badge.hidden = false;
    badge.textContent = s.badge;
  } else {
    badge.hidden = true;
  }

  const callBox = document.getElementById("callBox");
  const callLine = document.getElementById("callLine");
  if (s.call) {
    callBox.hidden = false;
    callLine.textContent = s.call;
  } else {
    callBox.hidden = true;
    callLine.textContent = "";
  }

  const excerpt = document.getElementById("excerpt");
  if (s.core) {
    excerpt.hidden = false;
    excerpt.textContent = PAY_CORE;
  } else {
    excerpt.hidden = true;
    excerpt.textContent = "";
  }

  const ul = document.getElementById("points");
  ul.replaceChildren();
  for (const p of s.points) {
    const li = document.createElement("li");
    li.textContent = p;
    ul.append(li);
  }

  const box = document.getElementById("runBox");
  const cmd = document.getElementById("runCmd");
  if (s.run) {
    box.hidden = false;
    cmd.textContent = s.runLabel;
  } else {
    box.hidden = true;
    cmd.textContent = "";
  }

  const runBtn = document.getElementById("runBtn");
  if (s.run) {
    runBtn.hidden = false;
    runBtn.disabled = busy;
    runBtn.textContent = busy ? "Running…" : ran ? "Run again" : "Run";
  } else {
    runBtn.hidden = true;
  }

  document.querySelector(".app").classList.toggle("talk", !s.run);

  if (busy) hint.innerHTML = "Running… wait. <kbd>Space</kbd> next.";
  else if (s.run && !ran) hint.innerHTML = "<kbd>Enter</kbd> pastes this into the terminal.";
  else if (index < slides.length - 1) hint.innerHTML = "<kbd>Space</kbd> next.";
  else hint.innerHTML = "Done. Stop recording.";
}

function collectLinks(text) {
  const found = text.match(HASHSCAN) ?? [];
  const unique = [...new Set(found)];
  links.replaceChildren();
  for (const href of unique) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = href.replace("https://hashscan.io/testnet/", "HashScan ");
    links.append(a);
  }
}

async function runCurrent() {
  const s = slides[index];
  if (!s.run || busy) return;
  const thisRun = ++runId;
  busy = true;
  ran = true;
  abort = new AbortController();
  term.classList.remove("idle");
  term.textContent = "";
  links.replaceChildren();
  setState("running", "run");
  renderSlide();

  try {
    const res = await fetch("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: s.run }),
      signal: abort.signal,
    });
    if (!res.ok || !res.body) {
      term.textContent += `\n[deck error HTTP ${res.status}]\n`;
      setState("error", "bad");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let code = 1;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.t === "cmd" || ev.t === "out") {
          term.textContent += ev.s;
          term.scrollTop = term.scrollHeight;
          collectLinks(term.textContent);
        } else if (ev.t === "end") {
          code = ev.code;
        }
      }
    }
    setState(code === 0 ? "done" : `exit ${code}`, code === 0 ? "ok" : "bad");
  } catch (err) {
    if (err && err.name === "AbortError") setState("stopped", "bad");
    else {
      term.textContent += `\n[${err instanceof Error ? err.message : "failed"}]\n`;
      setState("error", "bad");
    }
  } finally {
    if (thisRun !== runId) return;
    busy = false;
    abort = null;
    renderSlide();
  }
}

function resetTerm(message) {
  term.textContent = message;
  term.classList.toggle("idle", Boolean(message));
  links.replaceChildren();
  setState("idle", "");
}

function go(delta) {
  const next = index + delta;
  if (next < 0 || next >= slides.length) return;
  runId += 1;
  if (busy && abort) abort.abort();
  busy = false;
  abort = null;
  index = next;
  ran = false;
  const s = slides[index];
  resetTerm(s.run ? "Enter to run" : "");
  renderSlide();
}

document.addEventListener("keydown", (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Enter") {
    e.preventDefault();
    void runCurrent();
  } else if (e.key === " " || e.code === "Space") {
    e.preventDefault();
    go(1);
  } else if (e.key === "ArrowRight" || e.key === "n") go(1);
  else if (e.key === "ArrowLeft" || e.key === "p") go(-1);
  else if (e.key === "r" || e.key === "R") {
    ran = false;
    void runCurrent();
  } else if (e.key === "f" || e.key === "F") {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen();
    else void document.exitFullscreen();
  }
});

document.getElementById("runBtn").addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  void runCurrent();
});

resetTerm(slides[0].run ? "Enter to run" : "");
renderSlide();
