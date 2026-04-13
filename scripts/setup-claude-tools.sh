#!/usr/bin/env bash
# setup-claude-tools.sh
# Installs Brave Search MCP + useful Claude Code skills
# Run: bash scripts/setup-claude-tools.sh

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

step()  { echo -e "\n${BOLD}${CYAN}▶ $1${NC}"; }
ok()    { echo -e "  ${GREEN}✓ $1${NC}"; }
warn()  { echo -e "  ${YELLOW}⚠ $1${NC}"; }
die()   { echo -e "  ${RED}✗ $1${NC}"; exit 1; }

# ─── 1. Pre-flight ────────────────────────────────────────────────────────────
step "Checking prerequisites"

command -v claude >/dev/null 2>&1 || die "'claude' CLI not found. Install Claude Code first."
command -v node   >/dev/null 2>&1 || die "'node' not found. Install Node.js ≥18."
command -v npx    >/dev/null 2>&1 || die "'npx' not found. Comes with Node.js."
ok "claude, node, npx all present"

# ─── 2. Brave Search MCP ──────────────────────────────────────────────────────
step "Setting up Brave Search MCP server"

if claude mcp list 2>/dev/null | grep -q "brave-search"; then
  ok "brave-search MCP already configured — skipping"
else
  if [ -z "${BRAVE_API_KEY}" ]; then
    echo ""
    echo -e "  ${YELLOW}Brave Search requires a free API key.${NC}"
    echo    "  Get one at: https://brave.com/search/api/"
    echo -n "  Paste your BRAVE_API_KEY (or press Enter to skip): "
    read -r BRAVE_API_KEY
  fi

  if [ -z "${BRAVE_API_KEY}" ]; then
    warn "No API key provided — skipping Brave Search MCP"
    warn "Re-run with BRAVE_API_KEY=<key> to install later"
  else
    claude mcp add brave-search \
      -s user \
      -e BRAVE_API_KEY="${BRAVE_API_KEY}" \
      -- npx -y @modelcontextprotocol/server-brave-search
    ok "brave-search MCP added (user scope)"
  fi
fi

# ─── 3. Official plugins from marketplace ─────────────────────────────────────
step "Installing Claude Code plugins"

install_plugin() {
  local name="$1"
  local desc="$2"
  echo -n "  Installing ${name} (${desc})... "
  if claude plugin install "${name}" -s user 2>&1 | grep -qiE "(already installed|success|installed)"; then
    echo -e "${GREEN}✓${NC}"
  else
    # claude plugin install exits 0 even when already installed; just run it
    claude plugin install "${name}" -s user 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo -e "${YELLOW}may already be installed${NC}"
  fi
}

install_plugin "frontend-design"      "stunning UI components & pages"
install_plugin "claude-md-management" "CLAUDE.md audit & improvement"

# ─── 4. Custom skills ─────────────────────────────────────────────────────────
step "Writing custom skill files to ~/.claude/commands/"

CMDS_DIR="${HOME}/.claude/commands"
mkdir -p "${CMDS_DIR}"

# ── 4a. landing-page ──────────────────────────────────────────────────────────
cat > "${CMDS_DIR}/landing-page.md" << 'SKILL'
---
description: Build a production-grade, visually distinctive landing page for the current project. Use when asked to create, design, or generate a landing page, marketing page, or hero section.
allowed-tools: Read, Glob, Grep, Write, Edit, Bash
---

Create a complete, production-ready landing page for the project in the current working directory.

## Step 1: Research the Project

Read these files (if present) to understand what you're selling:
- `README.md`, `PRD.md`, `package.json` (name + description)
- Any existing landing or marketing page files

Extract: product name, tagline, core value propositions, target audience, key features, tech stack.

## Step 2: Choose a Bold Aesthetic Direction

Commit to ONE clear aesthetic — do not default to safe/generic. Examples:
- Dark, editorial, type-driven (think Vercel / Linear)
- Warm, textured, organic (think Notion / Loom)
- Loud, color-saturated, playful (think Figma / Framer)
- Minimal luxury with generous whitespace

Pick fonts from Google Fonts that match the tone. Avoid Inter, Roboto, Arial.

## Step 3: Design the Page Structure

Include these sections (adapt content to the product):
1. **Hero** — headline, sub-headline, primary CTA, optional visual/animation
2. **Problem / Hook** — one sentence on the pain point solved
3. **Features** — 3–4 key features with icons or visuals
4. **How It Works** — 3-step visual flow
5. **Social Proof / Stats** — placeholder metrics or quotes
6. **CTA Footer** — strong call-to-action with contact/link

## Step 4: Implement

Detect the frontend stack:
- If Next.js / React → create `landing/page.tsx` or `app/landing/page.tsx` using Tailwind + inline styles
- If plain HTML → create `landing/index.html` as a single self-contained file (embed CSS + JS)

Requirements:
- Fully responsive (mobile-first)
- CSS animations on hero entry and scroll-triggered feature cards
- Semantic HTML5 landmarks
- No external dependencies beyond CDN fonts and optionally Tailwind CDN

## Step 5: Verify

List the created/modified files and summarize:
- Aesthetic direction chosen and why
- Sections included
- How to view it locally
SKILL
ok "landing-page skill written"

# ── 4b. finalize-readme ───────────────────────────────────────────────────────
cat > "${CMDS_DIR}/finalize-readme.md" << 'SKILL'
---
description: Audit and finalize the project README. Use when asked to polish, improve, complete, or ship the README for a project.
allowed-tools: Read, Glob, Grep, Edit, Bash
---

Audit and rewrite the project README to be complete, clear, and compelling.

## Step 1: Gather Context

Read the following sources:
```bash
cat README.md 2>/dev/null || echo "(no README)"
cat package.json 2>/dev/null | head -30
ls -1 . | head -30
```
Also check `PRD.md`, `CLAUDE.md`, `plan.md`, `CHANGELOG.md` if present.

## Step 2: Evaluate the Current README

Score each section (present / missing / needs improvement):
- [ ] Project title + one-liner description
- [ ] Badges (build, license, version)
- [ ] Screenshot or demo GIF
- [ ] Feature list (bullet points, concise)
- [ ] Prerequisites / system requirements
- [ ] Installation (exact commands, copy-paste ready)
- [ ] Configuration (env vars, config files)
- [ ] Usage examples (with code blocks)
- [ ] Architecture overview (optional for complex projects)
- [ ] Contributing guide pointer
- [ ] License

Present the scorecard to the user before writing anything.

## Step 3: Propose Structure

Draft the new README outline. Show the user which sections you'll add, remove, or rewrite. Get approval before making changes.

## Step 4: Rewrite

Apply edits to `README.md` using these rules:
- First sentence must pass the "elevator pitch" test — what it is + who it's for
- All code blocks must have language tags
- Every install/run command must be copy-paste ready and tested
- No marketing fluff; every sentence earns its place
- Use tables for config/env vars
- Keep the total length under 300 lines for simple projects

## Step 5: Confirm

Show a summary of changes made and ask the user to review.
SKILL
ok "finalize-readme skill written"

# ── 4c. humanize ──────────────────────────────────────────────────────────────
cat > "${CMDS_DIR}/humanize.md" << 'SKILL'
---
description: Rewrite AI-generated or stiff text to sound natural, human, and conversational — without losing accuracy. Use when asked to humanize, make natural, rewrite, or de-AI text.
allowed-tools: Read, Edit
---

Rewrite the provided text (or the file at the given path) to sound genuinely human.

## Input

The user will either:
- Paste text directly in the message (rewrite it in your reply)
- Provide a file path (read and edit the file in-place after confirming)

## Rewriting Principles

**Voice & Tone**
- Match the appropriate register: casual blog ↔ professional docs ↔ technical write-up
- Use contractions naturally where appropriate ("you'll", "it's", "we've")
- Vary sentence length — mix short punchy sentences with longer ones
- Start sentences with "And", "But", "So" occasionally — humans do this
- Avoid corporate hedging: "leverage", "utilize", "synergize", "robust", "cutting-edge", "seamlessly"

**Structure**
- Break up walls of text into short paragraphs (2–4 sentences max)
- Use bullet points only for genuinely list-like content
- Lead with the most important point (inverted pyramid)

**Common AI tells to eliminate**
- Excessive adverbs: "certainly", "definitely", "absolutely", "importantly"
- Filler openers: "In today's world...", "It's worth noting that...", "It is important to..."
- Redundant affirmations: "Great question!", "Of course!", "Certainly!"
- Passive voice overuse — prefer active voice
- Overly parallel structure in every bullet
- Symmetric 3-part lists everywhere

**Accuracy**
- Do NOT change factual content, technical terms, or code
- Do NOT add opinions or information not in the source
- Preserve all links, code blocks, and structured data

## Output

If text was pasted: output the rewritten version directly.
If a file path was given: show a before/after diff of the key changes, then apply edits.

Ask if the user wants a more casual or more professional tone before rewriting if the target register is ambiguous.
SKILL
ok "humanize skill written"

# ─── 5. Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Setup complete!${NC}"
echo ""
echo -e "  ${BOLD}MCP Server${NC}"
echo    "    /brave-search  — web search via Brave API (if key was provided)"
echo ""
echo -e "  ${BOLD}Plugins installed${NC}"
echo    "    frontend-design      → /frontend-design skill"
echo    "    claude-md-management → /claude-md-improver skill + /revise-claude-md command"
echo ""
echo -e "  ${BOLD}Custom skills (user-global)${NC}"
echo    "    /landing-page    — build a polished landing page for any project"
echo    "    /finalize-readme — audit & rewrite README to ship-ready quality"
echo    "    /humanize        — strip AI-speak from any text or file"
echo ""
echo -e "  Reload Claude Code (close & reopen) for all changes to take effect."
echo ""
