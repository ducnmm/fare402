const HASHSCAN = /https:\/\/hashscan\.io\/[^\s"'<>]+/g;

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
    title: "Two tickets",
    say: "Hedera lookups, and a Node job on AWS Lambda.",
    points: [
      "Lookups — account balance and recent transactions",
      "Jobs — run a short script, get stdout",
      "Bigger ask → higher fare",
    ],
    run: null,
  },
  {
    id: "pay",
    kicker: "how it pays",
    title: "No pay, no data",
    say: "You hit a route. Merchant answers HTTP 402 with a quote. You pay. You get JSON.",
    points: ["1 unit = 0.001 HBAR", "x402 on Hedera · Blocky402 is the fee payer"],
    run: null,
  },
  {
    id: "ping402",
    kicker: "live",
    title: "Ask without paying",
    say: "402. Quote is 0.001 HBAR. No JSON body yet.",
    points: ["Point at HTTP 402", "Then PAYMENT-REQUIRED"],
    run: "ping402",
    runLabel: "curl -si https://fare-production.up.railway.app/v1/ping",
  },
  {
    id: "account",
    kicker: "live",
    title: "Pay for a lookup",
    say: "0.001 HBAR → live balance of Hedera account 0.0.98.",
    points: ["YOU ASKED → QUOTED → PAID → YOU GOT", "Open the HashScan link"],
    run: "account",
    runLabel: "fare account 0.0.98",
  },
  {
    id: "txs",
    kicker: "live",
    title: "More data, higher fare",
    say: "Same account, 25 transactions. 0.004 HBAR — four times the lookup. Wait.",
    points: ["YOU GOT should list 25 rows"],
    run: "txs",
    runLabel: "fare txs 0.0.98 25",
  },
  {
    id: "job",
    kicker: "live",
    title: "Pay for a job",
    say: "0.002 HBAR. Lambda runs the script. stdout is 2.",
    points: ["provider aws-lambda", "stdout 2"],
    run: "job",
    runLabel: "fare job 10 'console.log(1+1)'",
  },
  {
    id: "hcs",
    kicker: "live",
    title: "Written on Hedera",
    say: "Each payment also lands on this HCS topic. That's it.",
    points: ["Newest messages on topic 0.0.10320508"],
    run: "hcs",
    runLabel: "fare topic",
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
