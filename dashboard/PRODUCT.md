# PowMon — Product

## Problem

A hybrid solar inverter knows everything about a home's energy — how much sun
is coming in, what the battery holds, what the grid is charging you — but it
speaks in registers, acronyms, and a two-line LCD. The people who paid for the
panels can't answer the questions they actually have: *Is it working? Am I
spending or saving money right now? Is the battery okay?*

## Solution

A live web dashboard on the local network that translates the inverter into
human terms: plain-language values, history you can scan, and money — because
currency is the one energy unit everyone already understands.

## Vision

Anyone in the household — not just the person who built the system — can
glance at a screen and know how the solar system is doing, in their own
language, without being taught.

## Mission

Make the inverter's truth legible: every number explained, every trend
visible, every kWh translated into what it cost or saved.

## Who it's for

1. **The owner/builder** — checks daily, wants trends, savings, and early
   warning signs.
2. **The household** — glances occasionally; needs the green dot, today's
   story, and nothing they have to study.
3. **The wall tablet** — always on; the dashboard must stay current without
   anyone touching it.

## Product principles

These decide debates. When a proposal conflicts with one, the principle wins
or the principle gets explicitly changed here.

- **Glanceable first.** The most important state (online, mode, money today)
  must be readable in three seconds from across a room. Depth lives one level
  down (hints, charts, settings) — never in the first glance's way.
- **No jargon without a hand.** Every value a user can see offers a
  plain-language explanation of what it means and what's normal. If a value
  can't be explained simply, question whether it belongs on screen.
- **Money is a first-class metric.** Energy data converts to currency wherever
  it helps judgment. Spent vs. saved is the product's headline story.
- **Honest numbers only.** Show what the inverter reports, or transparent
  arithmetic on it. Never display a derived pseudo-metric that can mislead
  (the V×A "Grid Power" lesson). If a number needs an asterisk, it needs a
  redesign.
- **Watch, don't touch.** PowMon reads. It never writes to the inverter.
  Nothing on screen can break the power system — a safety and trust
  guarantee, not a missing feature.
- **Local and private.** Runs on the home network. No cloud account, no
  sign-in, no data leaving the house.
- **Both languages are real.** English and Spanish are maintained as equals;
  English fills gaps. A language we can't maintain well is a language we
  don't ship.
- **Every screen size, one hierarchy.** Wide screens earn density; small
  screens get the same information stacked — never a different product.

## Style guide

- **Color = meaning, everywhere.** Amber is solar, red is load/consumption,
  green is battery/savings/health, indigo is grid. A color used in a chart
  line means the same in a stat row or a money figure. Never reassign.
- **Calm surface.** Neutral panels, thin lines, one accent. The data provides
  the color; the chrome stays quiet. Light, dark, and follow-the-OS are all
  first-class.
- **Text tone:** short, concrete, friendly-plain. Hints talk like a neighbor
  explaining, not a datasheet ("Power your solar panels are producing right
  now. 0 at night…").
- **Density with hierarchy:** compact rows and grouped cards over big tiles;
  uppercase micro-labels for groups; tabular numerals for values.

## What this is not

- Not an inverter configurator or control panel.
- Not a cloud product or a public website.
- Not an analytics workbench — filters and ranges serve "what happened?",
  not data science.

## One line

The inverter speaks engineer; PowMon translates it into glances, plain words,
and money.
