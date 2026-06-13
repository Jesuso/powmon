# SRNE / PowMr SP5K — Config Setpoint Registers

Cross-reference of the inverter's **setup menu** (manual §5.2), the **live device
values**, and the **Modbus config registers**. Names come from the **SRNE Modbus
V2.07 protocol** (P05/P06 setting areas — see [`SOURCES.md`](./SOURCES.md) for the
document link and credits), verified against the device with
[`powmr_config_poll.py`](./powmr_config_poll.py) sweeps and perturbation tests
(2026-06-08 → 2026-06-10).

Inverter: SRNE-based PowMr SP5K, 48 V split-phase, fw `SR-240618-0143-301`.
Manual: `pow-sunsmart-sp5k-user-manual-v1-3-0518.pdf` §5.2.

## Layout & scaling rules

- Three live config blocks: **`0xE000–0xE033`** (P05 battery), **`0xE100–0xE131`**
  (factory calibration — leave alone), **`0xE200–0xE21B`** (P06 inverter).
  Plus **`0xDF00–0xDF0D`** (P03 device control — **write-only commands**).
- **E0xx battery voltages** are stored **12 V-normalized ×0.1**:
  `actual_V = raw × 0.4` on this 48 V bank (54.8 V → raw 137).
- **E0xx/E2xx currents** are ×0.1 A. **E208** output V is ×0.1, **E209** freq ×0.01.
- Durations/counts/% / enums are raw ×1. Temps are signed °C (−30 → raw 65506).
- Read-only (fn 0x03). **Never write** without intent; `0xDF0D` *starts an
  equalize charge* on write.

## Behaviour logic (the params that drive grid ↔ battery ↔ solar)

| # | Param | Device | Effect |
|---|---|---|---|
| 01 | Supply Priority | **PV1ST** (Solar First) | Run on inverter; switch to **Mains** only when PV fails **or** battery < [04] |
| 04 | Battery → Mains | **48.0 V** | Battery below this → output switches inverter→**Mains** (the bypass-on point) |
| 05 | Mains → Battery | **54.8 V** | Battery above this → output switches Mains→**inverter** (the release point) |
| 06 | Charging Mode | **ONLY PV** | **Mains never charges the battery** — bypass only |

These four fully explain the observed day: prev-evening battery dropped below 48 V →
bypassed to mains; ONLYPV means mains carried load but never recharged → overnight SoC
sag; dawn PV recharged; crossing **54.8 V (param 05)** released back to inverter.
This is also why the inverter's "Mains Charging Power" register is phantom (always ~190 W
nominal): mains charging is disabled.

## Register map — P05 battery (`0xE0xx`)

✅ = perturbation-verified. Others match protocol name + device value.
[nn] = LCD menu number.

| Reg | Protocol name | LCD | Device value | Scale |
|---|---|---|---|---|
| `0xE000` | BatParmReserved0 | — | 0 | |
| `0xE001` | PvChgCurrSet | [36] | 20.0 A | ×0.1 A ✅ |
| `0xE002` | BatRateCap | — | 100 Ah | ×1 |
| `0xE003` | BatRateVolt | — | 48 V | ×1 |
| `0xE004` | BatTypeSet | [08] | 2 = FLD | enum (0=user,1=SLD,2=FLD,3=GEL,4+=Li) |
| `0xE005` | BatOverVolt | — | 62.0 V | ×0.4 |
| `0xE006` | BatChgLimitVolt (over-charge protection) | — | 57.6 V | ×0.4 — NOT [09] |
| `0xE007` | BatConstChgVolt (equalize V) | [17] | 59.2 V | ×0.4 ✅ |
| `0xE008` | BatImprovChgVolt (boost) | [09] | 58.4 V | ×0.4 ✅ (FLD preset boost = 58.4 per manual table) |
| `0xE009` | BatFloatChgVolt | [11] | 55.2 V | ×0.4 |
| `0xE00A` | BatImprovChgBackVolt (re-boost point) | [37] | 52.0 V | ×0.4 ✅ |
| `0xE00B` | BatOverDischgBackVolt | [35] | 52.0 V | ×0.4 ✅ |
| `0xE00C` | BatUnderVolt (alarm) | [14] | 44.0 V | ×0.4 |
| `0xE00D` | BatOverDischgVolt | [12] | 42.0 V | ×0.4 |
| `0xE00E` | BatDischgLimitVolt | [15] | 40.0 V | ×0.4 |
| `0xE00F` | BatStopSOC (discharge cut-off) | — | 5 % | ×1 |
| `0xE010` | BatOverDischgDelayTime | [13] | 5 s | ×1 |
| `0xE011` | BatConstChgTime (equalize time) | [18] | 120 min | ×1 ✅ |
| `0xE012` | BatImprovChgTime (boost time) | [10] | 120 min | ×1 ✅ |
| `0xE013` | BatConstChgGapTime (equalize interval) | [20] | 30 days | ×1 ✅ |
| `0xE014` | CoeffTemperCompen | — | 5 mV/°C/2cell | ×1 |
| `0xE015`–`0xE01A` | Chg/DisChg temp limits, heater start/stop | — | 60/−30/60/−30/0/5 °C | signed |
| `0xE01B` | BatSwitchDcVolt | [04] | 48.0 V | ×0.4 ✅ |
| `0xE01C` | StopChgCurrSet (tail current) | [57] | 4.0 A | ×0.1 A |
| `0xE01D` | StopChgSocSet | — | 100 % | ×1 — **NOT [15]**; old ha-solarman label wrong |
| `0xE01E` | BatSocLowAlarm | — | 15 % | ×1 |
| `0xE01F` | BatSocSwToLine | — | 10 % | ×1 |
| `0xE020` | BatSocSwToBatt | — | 100 % | ×1 |
| `0xE021` | BatDischgMaxCurrSet | — | 0 | ×0.1 A? |
| `0xE022` | BattVoltSwToInv | [05] | 54.8 V | ×0.4 ✅ |
| `0xE023` | BattEqualChgTimeout (equalize delay) | [19] | 240 min | ×1 ✅ |
| `0xE024` | LiBattActiveCurrSet | — | 3.0 A | ×0.1 A — **NOT [28]** |
| `0xE025` | BMSChgLCMode | — | 1 | enum |
| `0xE026`–`0xE033` | Timed charge/discharge windows + enables | [40]–[53] | 0 (disabled) | |

## Register map — P06 inverter (`0xE2xx`)

| Reg | Protocol name | LCD | Device value | Scale |
|---|---|---|---|---|
| `0xE200` | Rs485AddrSet | [30] | 1 | ×1 |
| `0xE201` | ParallMode | — | 0 | enum |
| `0xE202`/`0xE203` | PassWordSet / PassWordInput | — | (reads 666 / 0) | write regs |
| `0xE204` | OutputPriority | [01] | 0 = SOL (PV1ST) | enum 0=SOL,1=UTI,2=SBU |
| `0xE205` | IbattLineChgLimit | [28] | 30.0 A | ×0.1 A |
| `0xE206` | **BattEqualChgEnable** | [16] | 1 = ENA | enum |
| `0xE207` | N_G_FuncEn | [63] | 1 = ENA | enum |
| `0xE208` | OutputVoltSet | [38] | 120.0 V | ×0.1 V |
| `0xE209` | OutputFreqSet | [02] | 60.00 Hz | ×0.01 Hz |
| `0xE20A` | MaxChgCurr (total) | [07] | 25.0 A | ×0.1 A |
| `0xE20B` | AcVoltRange | [03] | 1 = UPS | enum 0=APL,1=UPS |
| `0xE20C` | PowerSavingMode (ECO) | [22] | 0 = DIS | enum |
| `0xE20D` | AutoRestartOvLoad | [23] | 1 = ENA | enum |
| `0xE20E` | AutoRestartOvTemper | [24] | 1 = ENA | enum |
| `0xE20F` | ChgSourcePriority | [06] | 3 = ONLY PV | enum 0=PV1st,1=mains1st,2=hybrid,3=only-PV |
| `0xE210` | AlarmEnable (buzzer) | [25] | 1 = ENA | enum |
| `0xE211` | AlarmEnWhenSourceLoss | [26] | 1 = ENA | enum |
| `0xE212` | BypEnableWhenOvLoad | [27] | 1 = ENA | enum |
| `0xE213` | RecordFaultEnable | — | 1 | enum |
| `0xE214`/`0xE215` | BmsErrStopEnable / BmsCommEnable | [32]? | 0 / 0 | enum |
| `0xE21B` | Rs485BmsProtocol | [32]? | 7 | enum |
| `0xE21E` | OutputPhaseSet | [31] | (illegal on this fw) | enum |

## Device control commands (`0xDF0x`, WRITE-ONLY — fn 0x06, never sweep-write)

| Reg | Protocol name | LCD | Action |
|---|---|---|---|
| `0xDF00` | CmdPowerOnOff | — | 0=off, 1=on |
| `0xDF01` | CmdReset | — | 1=reset |
| `0xDF02` | CmdRestoreFactorySetting | — | 0xAA restore, 0xBB clear power stats, 0xCC clear fault history |
| `0xDF0D` | **BattEqualChgImmediate** | [21] | start equalize charge now ⚠️ |

## Equalization parameter set — complete

| # | Manual name | Device | Register |
|---|---|---|---|
| 16 | Equalization Charge ENA/DIS | ENA | `0xE206` ✅ |
| 17 | Equalization Voltage | 59.2 V | `0xE007` ✅ |
| 18 | Equalization Charging Time | 120 min | `0xE011` ✅ |
| 19 | Equalized Charging Delay | 240 min | `0xE023` ✅ |
| 20 | Equalization Charge Interval | 30 days | `0xE013` ✅ |
| 21 | Equalization Start-Stop (trigger) | — | `0xDF0D` (write-only command) ⚠️ |

## Open questions

- `0xE100–0xE131`: factory calibration / minor-load-current coefficients per the V2.07
  changelog (E110–E112). Don't touch.
- The raw-120/raw-130 values at `0xE12D`/`0xE121` live in the calibration block —
  unrelated to setpoints.

## ⚠️ Battery-type switch ([08]) wipes custom setpoints

Observed 2026-06-10: changing [08] FLD→USER reloaded type presets over the custom
values — [04] 48.0→43.6, [05] 54.8→57.6, [17] 59.2→57.2, [20] 30→120 d, OV 62.0→60.0.
Switching back reloads FLD presets again. **After any [08] change, re-enter all custom
setpoints and run `--save` to diff against the DB snapshot.**

USER-mode quirk: editing [09] Boost writes `0xE008` and *clamps* `0xE007` (equalize)
and `0xE009` (float) down to the same value if they exceed it, while the LCD menu
items [11]/[17] keep displaying their old values — the registers are authoritative,
the menu display is stale.

## Perturbation test log (2026-06-10)

Method: bump colliding params on the LCD by *distinct* deltas, re-sweep read-only, diff.

- Round 1 (raw-120 trio): [04]→48.4 V, [10]→130 min, [18]→135 min ⇒ `0xE01B` 121,
  `0xE012` 130, `0xE011` 135. Reverted.
- Round 2 (raw-130 pair): [35]→52.4, [37]→52.8 ⇒ `0xE00B` 131, `0xE00A` 132. Reverted.
- Round 3: [36] 20→15 A ⇒ `0xE001` 200→150 (×0.1 A); [20] 30→28 d ⇒ `0xE013`;
  [19] 240→245 ⇒ `0xE023`; [16] ENA→DIS moved *nothing* in E0xx/E1xx ⇒ led to the
  E2xx block + V2.07 PDF discovery. Reverted.
- Round 4 ([09] boost, needed [08]→USER to unlock): [09]→48.4 ⇒ `0xE008` moved AND
  dragged `0xE007`/`0xE009` to the same value (clamp) ⇒ [09] = `0xE008`, matching the
  protocol name; `0xE006` ruled out (also exposed the type-switch preset wipe, above).

Register order does **not** follow menu order.

## Full menu snapshot (device, 2026-06-08; [19] re-read 06-10)

| # | Manual name | Device value | vs default |
|---|---|---|---|
| 01 | Supply Priority | PV1ST | vs AC1ST |
| 02 | Output Frequency | 60.0 Hz | default |
| 03 | AC Input Voltage | UPS (90–140 V) | default |
| 04 | Battery → Mains | 48.0 V | vs 43.6 ↑ |
| 05 | Mains → Battery | 54.8 V | vs 56.8 ↓ |
| 06 | Charging Mode | ONLY PV | vs Hybrid |
| 07 | Max Charging Current | 25 A | vs 60 ↓ |
| 08 | Battery Type | FLD (flooded) | vs GEL |
| 09 | Boost Voltage | (57.6 V, reg) | default |
| 10 | Max Boost Duration | 120 min | default |
| 11 | Float Charge Voltage | 55.2 V | default |
| 12 | Over-discharge Voltage | 42.0 V | default |
| 13 | Over-discharge Delay | 5 s | default |
| 14 | Under-voltage Alarm | 44.0 V | default |
| 15 | Discharge Limit Voltage | (40 V, reg) | default |
| 16 | Equalization Charge | ENA | default |
| 17 | Equalization Voltage | 59.2 V | vs 58 ↑ |
| 18 | Equalization Time | 120 min | default |
| 19 | Equalize Charging Delay | 240 min | vs 120 ↑ |
| 20 | Equalize Interval | 30 days | default |
| 21 | Equalize Start-Stop | DIS | default |
| 22 | ECO Mode | DIS | default |
| 23 | Overload Auto-Restart | ENA | default |
| 24 | Over-temp Auto-Restart | ENA | default |
| 25 | Buzzer Alarm | ENA | default |
| 26 | Mode-Change Alarm | ENA | default |
| 27 | Inverter-Overload→Mains | ENA | default |
| 28 | Grid Charge Current | 30 A | vs 40 ↓ |
| 30 | RS485 Address | 1 | default |
| 31 | AC Output Mode | SIG (single) | default |
| 32 | Battery Comm / BMS | SLA | — |
| 33 | (WOW) | WOW | — |
| 34 | Power Generation (backflow) | DIS | default |
| 35 | Under-Voltage Recovery | 52.0 V | default |
| 36 | Max PV Charger Current | 20 A | vs 80 ↓ |
| 37 | Battery Recharge Voltage | 52.0 V | default |
| 38 | Output Voltage | 120 Vac | default |
| 40–45 | Timed charge windows | 00:00:00 | default |
| 46 | Sectional Charging | DIS | default |
| 47–52 | Timed discharge windows | 00:00:00 | default |
| 53 | Sectional Discharge | DIS | default |
| 54 | Date | 26:06:08 (Y:M:D) | — |
| 55 | Time | (current) | — |
| 57 | Charge tail-current cutoff | 4.0 A | vs 2 ↑ |
| 63 | (NG — neutral/ground bond) | ENA | — |

## Rediscover / snapshot

```sh
./powmr_config_poll.py          # sweep all three known blocks, labeled
./powmr_config_poll.py --save   # snapshot 21 confirmed setpoints -> dashboard/data.db (config table)
```

Setpoints rarely change → poll the block occasionally into the append-on-change
`config` table; `config_history` records diffs for dashboard event markers.
