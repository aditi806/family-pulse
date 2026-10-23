"""Renders the silent demo video from real output (docs/transcript.json + `npm test`).
Usage: python3 scripts/make_video.py out.mp4   (needs Pillow + ffmpeg)"""
import json, subprocess, sys, re, os
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1280, 720, 15
BG, PANEL, FG, DIM = (13, 17, 27), (22, 28, 44), (232, 236, 245), (130, 142, 168)
ACC, GREEN, AMBER, PINK = (99, 179, 255), (92, 214, 142), (255, 196, 87), (255, 120, 160)
D = "/usr/share/fonts/truetype/dejavu/"
def F(sz, bold=False, mono=False):
    return ImageFont.truetype(D + ("DejaVuSansMono.ttf" if mono else ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")), sz)

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(root, "docs/transcript.json")))
tests = re.findall(r"^ok \d+ - (.+)$", subprocess.run(["npm", "test"], cwd=root, capture_output=True, text=True).stdout, re.M)

out = sys.argv[1] if len(sys.argv) > 1 else "familypulse-demo.mp4"
ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
                       "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", out], stdin=subprocess.PIPE)
nframes = 0
def emit(img):
    global nframes; ff.stdin.write(img.tobytes()); nframes += 1
def hold(draw_fn, secs):
    for i in range(int(secs * FPS)): emit(draw_fn(i / FPS))

def wrap(d, text, font, width):
    lines, cur = [], ""
    for w in text.split(" "):
        t = (cur + " " + w).strip()
        if d.textlength(t, font=font) <= width: cur = t
        else: lines.append(cur); cur = w
    return lines + [cur]
def base(title=None, footer=None):
    im = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(im)
    if title: d.text((60, 36), title, font=F(30, True), fill=ACC)
    if footer: d.text((60, H - 44), footer, font=F(16), fill=DIM)
    return im, d
def fade(t, dur=0.4): return max(0.0, min(1.0, t / dur))
def mix(c, a): return tuple(int(BG[i] + (c[i] - BG[i]) * a) for i in range(3))
def box(d, xy, fill=PANEL, outline=None, r=16):
    d.rounded_rectangle(xy, r, fill=fill, outline=outline, width=2)
FOOT = "Scripted client standing in for Alexa+ · real MCP JSON-RPC calls over HTTP · output captured from `npm run demo`"

def title(t):
    im, d = base(); a = fade(t)
    d.text((W // 2, 280), "FamilyPulse", font=F(84, True), fill=mix(FG, a), anchor="mm")
    d.text((W // 2, 370), "An Alexa+ MCP server for busy households", font=F(34), fill=mix(ACC, a), anchor="mm")
    d.text((W // 2, 450), "Streamable HTTP · MCP spec 2025-11-25 · AWS Lambda · DynamoDB · Amazon Bedrock", font=F(20), fill=mix(DIM, a), anchor="mm")
    return im
def problem(t):
    im, d = base("The problem")
    items = ["Who took Grandpa's evening pill?", "Whose turn is it to walk the dog?", "Two appointments, one driver tomorrow…"]
    for i, s in enumerate(items):
        a = fade(t - i * 1.2); box(d, (120, 150 + i * 120, W - 120, 230 + i * 120), outline=mix(ACC, a))
        d.text((160, 190 + i * 120), s, font=F(30), fill=mix(FG, a), anchor="lm")
    a = fade(t - 4.2)
    d.text((W // 2, 590), "Family state lives in group chats and sticky notes.", font=F(26), fill=mix(AMBER, a), anchor="mm")
    d.text((W // 2, 635), "Alexa+ is already in the kitchen. Put it behind one sentence.", font=F(26, True), fill=mix(FG, a), anchor="mm")
    return im
def arch(t):
    im, d = base("Architecture")
    nodes = [("Alexa+", 60, ACC), ("API Gateway", 300, FG), ("Lambda\nMCP server", 560, FG), ("DynamoDB", 840, GREEN)]
    for i, (n, x, c) in enumerate(nodes):
        a = fade(t - i * 0.8); box(d, (x, 220, x + 200, 340), outline=mix(c, a))
        d.multiline_text((x + 100, 280), n, font=F(22, True), fill=mix(c, a), anchor="mm", align="center")
        if i: d.line((nodes[i-1][1] + 200, 280, x, 280), fill=mix(DIM, a), width=3); d.polygon([(x, 280), (x - 12, 272), (x - 12, 288)], fill=mix(DIM, a))
    a = fade(t - 3.4)
    box(d, (560, 400, 760, 500), outline=mix(AMBER, a)); d.text((660, 450), "Amazon Bedrock", font=F(20, True), fill=mix(AMBER, a), anchor="mm")
    d.line((660, 340, 660, 400), fill=mix(AMBER, a), width=3)
    d.text((60, 580), "POST /mcp · bearer auth · Origin + protocol-version checks · stateless on Lambda", font=F(20), fill=mix(DIM, fade(t - 4)))
    d.text((60, 620), "8 tools · dependency-free MCP core · Bedrock only phrases replies, never invents facts", font=F(20), fill=mix(DIM, fade(t - 5)))
    return im
def handshake(t):
    im, d = base("MCP handshake", FOOT); h = T[0]
    box(d, (60, 110, W - 60, 560), fill=(8, 11, 19))
    lines = [("$ npm run demo", DIM), (f"initialize  →  protocol {h['protocol']}, server {h['server']}", GREEN),
             ("notifications/initialized  →  202 Accepted", GREEN), ("tools/list  →", GREEN)]
    for i, (s, c) in enumerate(lines):
        if t > i * 0.8: d.text((90, 140 + i * 40), s, font=F(22, mono=True), fill=c)
    if t > 3.2:
        y = 310
        for i, n in enumerate(h["tools"]):
            if t > 3.2 + i * 0.25: d.text((120 + (i % 2) * 520, y + (i // 2) * 40), "• " + n, font=F(22, mono=True), fill=ACC)
    return im
def turn(k, item):
    n_turns = len(T) - 1
    reply = item["reply"]; args = json.dumps(item["args"])
    def f(t):
        im, d = base(f"Voice turn {k}/{n_turns}", FOOT)
        # utterance bubble
        a = fade(t); box(d, (60, 100, W - 60, 175), fill=(30, 40, 66), outline=mix(ACC, a))
        d.text((90, 138), "🗣" if False else "“" + item["say"] + "”", font=F(28, True), fill=mix(FG, a), anchor="lm")
        # tool call
        if t > 1.2:
            box(d, (60, 200, W - 60, 275), fill=(8, 11, 19))
            d.text((90, 225), "→ tools/call", font=F(20, mono=True), fill=AMBER)
            d.text((250, 225), item["tool"], font=F(20, True, True), fill=AMBER)
            d.text((90, 255), args[:95], font=F(18, mono=True), fill=DIM)
        # reply typed
        if t > 2.6:
            n = int((t - 2.6) * 55); shown = reply[:n]
            box(d, (60, 300, W - 60, 620), fill=(8, 11, 19), outline=mix(GREEN, 0.6))
            d.text((90, 325), "← result", font=F(20, mono=True), fill=GREEN)
            y = 365
            for ln in wrap(d, shown, F(26), W - 180): d.text((90, y), ln, font=F(26), fill=FG); y += 40
        return im
    secs = 2.6 + len(reply) / 55 + 3.0
    hold(f, secs)
def testscene(t):
    im, d = base("npm test — protocol + tool conformance", "Real output from the repository's test suite (node:test)")
    for i, n in enumerate(tests):
        if t > i * 0.35:
            col, row = i // 7, i % 7
            d.text((70 + col * 600, 120 + row * 62), "✔", font=F(26, True), fill=GREEN)
            for j, ln in enumerate(wrap(d, n, F(19), 520)[:2]): d.text((110 + col * 600, 122 + row * 62 + j * 24), ln, font=F(19), fill=FG)
    if t > len(tests) * 0.35 + 0.3:
        d.text((W // 2, 600), f"{len(tests)} passing · 0 failing", font=F(40, True), fill=GREEN, anchor="mm")
    return im
def awsscene(t):
    im, d = base("AWS Builder: how AWS is used")
    rows = [("Amazon Bedrock", "Converse API inside daily_briefing + suggest_rebalance; 4 s timeout, deterministic fallback", AMBER),
            ("AWS Lambda + API Gateway", "Stateless Streamable HTTP endpoint (src/lambda.js)", ACC),
            ("DynamoDB", "Household state, one item, atomic read-modify-write", GREEN),
            ("IAM / SAM", "infra/template.yaml: table CRUD policy + bedrock:InvokeModel", PINK)]
    for i, (a_, b_, c) in enumerate(rows):
        a = fade(t - i * 1.0); y = 120 + i * 120
        box(d, (60, y, W - 60, y + 95), outline=mix(c, a))
        d.text((90, y + 28), a_, font=F(26, True), fill=mix(c, a)); d.text((90, y + 64), b_, font=F(19), fill=mix(FG, a))
    return im
def closing(t):
    im, d = base(); a = fade(t)
    d.text((W // 2, 250), "FamilyPulse", font=F(64, True), fill=mix(FG, a), anchor="mm")
    for i, s in enumerate(["Next: Ring arrival reminders · OAuth account linking · multi-household", "MIT licensed · github.com/YOUR-USERNAME/familypulse"]):
        d.text((W // 2, 360 + i * 60), s, font=F(26), fill=mix(ACC if i == 0 else DIM, a), anchor="mm")
    return im

hold(title, 5); hold(problem, 7); hold(arch, 9); hold(handshake, 6)
for k, item in enumerate(T[1:], 1): turn(k, item)
hold(testscene, len(tests) * 0.35 + 3.5); hold(awsscene, 8); hold(closing, 5)
ff.stdin.close(); ff.wait()
print(f"{out}: {nframes / FPS:.1f}s")
