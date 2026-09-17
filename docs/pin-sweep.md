# Pin-to-pin connection coverage

Generated 2026-09-17 by `npm run sweep`. Every pin of every part was connected to every pin of every other part, one pair at a time, and the deterministic rules ran on the result.

**Basis.** Expectations come from the KiCad default ERC pin-type matrix (the industry list of which pin electrical types may share a net), plus domain rules for what that matrix cannot express: shorts to ground and motors that need a driver. **This is best effort, and honest about it.** *Covered* means every tested pair of that kind produced a violation or warning. *Allowed* means KiCad calls the pairing OK and silence is correct. *Gap* means KiCad calls it OK but a domain expert would still question it and no rule models it yet; the reason is in the last column. The coverage panel in the app lists evaluated dimensions for the same reason: a clean findings list only speaks for what was checked.

## Bluetooth Race Car

634 pin pairs · 11 covered kinds · 12 allowed kinds · 15 gap kinds · 0 missed

| Pin roles | KiCad | Expectation | Pairs | Fired | Verdict | Why |
| --- | --- | --- | --- | --- | --- | --- |
| cap to diode | OK | gap | 2 | 2 | gap | diode into a capacitor: not modeled |
| cap to gpio | OK | gap | 11 | 11 | gap | capacitor on a GPIO: not modeled |
| cap to ground | OK | allowed | 5 | 5 | allowed | KiCad OK; legitimate wiring |
| cap to logic_in | OK | gap | 7 | 7 | gap | capacitor on a logic input: not modeled |
| cap to motor_in | OK | gap | 4 | 4 | gap | capacitor across a motor: not modeled |
| cap to motor_out | OK | gap | 4 | 4 | gap | capacitor on a bridge output: not modeled |
| cap to source | OK | allowed | 2 | 2 | allowed | KiCad OK; legitimate wiring |
| cap to supply_in | OK | allowed | 2 | 2 | allowed | KiCad OK; legitimate wiring |
| diode to gpio | OK | gap | 22 | 11 | gap | diode on a GPIO: not modeled |
| diode to ground | OK | allowed | 12 | 12 | allowed | KiCad OK; legitimate wiring |
| diode to logic_in | OK | gap | 14 | 7 | gap | diode into a logic input: not modeled |
| diode to motor_in | OK | gap | 8 | 4 | gap | diode into a motor winding: flyback topology, not modeled |
| diode to motor_out | OK | gap | 8 | 4 | gap | diode across a bridge output: not modeled |
| diode to source | OK | gap | 5 | 4 | gap | diode terminal on a supply: direction not modeled |
| diode to supply_in | OK | gap | 7 | 6 | gap | diode feeding a supply input: forward drop is modeled only along the fixture path |
| gpio to ground | OK | finding | 55 | 55 | covered | domain rule (ground short, motor drive) |
| gpio to logic_in | OK | allowed | 70 | 0 | allowed | KiCad OK; legitimate wiring |
| gpio to motor_in | OK | finding | 44 | 44 | covered | domain rule (ground short, motor drive) |
| gpio to motor_out | OK | allowed | 44 | 44 | allowed | KiCad OK; legitimate wiring |
| gpio to source | WAR | finding | 22 | 22 | covered | KiCad ERC warning |
| gpio to supply_in | OK | gap | 33 | 22 | gap | a GPIO powering a module supply input: pin types are compatible but a GPIO cannot source module current; not modeled |
| ground to logic_in | OK | allowed | 35 | 35 | allowed | KiCad OK; legitimate wiring |
| ground to motor_in | OK | finding | 24 | 24 | covered | domain rule (ground short, motor drive) |
| ground to motor_out | OK | finding | 20 | 20 | covered | domain rule (ground short, motor drive) |
| ground to source | OK | finding | 14 | 14 | covered | domain rule (ground short, motor drive) |
| ground to supply_in | OK | finding | 19 | 19 | covered | domain rule (ground short, motor drive) |
| logic_in to motor_in | OK | allowed | 28 | 28 | allowed | KiCad OK; legitimate wiring |
| logic_in to source | OK | allowed | 21 | 21 | allowed | KiCad OK; legitimate wiring |
| logic_in to supply_in | OK | gap | 14 | 7 | gap | a logic input tied to a supply input with no source: covered only when a source joins the net |
| motor_in to motor_in | OK | finding | 4 | 4 | covered | domain rule (ground short, motor drive) |
| motor_in to motor_out | OK | allowed | 12 | 12 | allowed | KiCad OK; legitimate wiring |
| motor_in to source | OK | finding | 12 | 12 | covered | domain rule (ground short, motor drive) |
| motor_in to supply_in | OK | gap | 16 | 12 | gap | a motor winding on a supply input: the motor would be driven by whatever supplies that pin; not modeled |
| motor_out to source | ERR | finding | 12 | 12 | covered | KiCad ERC error |
| motor_out to supply_in | OK | gap | 8 | 4 | gap | an H-bridge output feeding a supply input: switching supply, not modeled |
| source to source | ERR | finding | 3 | 3 | covered | KiCad ERC error |
| source to supply_in | OK | allowed | 7 | 6 | allowed | KiCad OK; legitimate wiring |
| supply_in to supply_in | OK | allowed | 4 | 4 | allowed | KiCad OK; legitimate wiring |

## Connected Video Doorbell

177 pin pairs · 8 covered kinds · 21 allowed kinds · 1 gap kinds · 0 missed

| Pin roles | KiCad | Expectation | Pairs | Fired | Verdict | Why |
| --- | --- | --- | --- | --- | --- | --- |
| bus to bus | OK | allowed | 15 | 0 | allowed | KiCad OK; legitimate wiring |
| bus to gpio | OK | allowed | 8 | 0 | allowed | KiCad OK; legitimate wiring |
| bus to ground | OK | allowed | 17 | 0 | allowed | KiCad OK; legitimate wiring |
| bus to source | WAR | finding | 12 | 12 | covered | KiCad ERC warning |
| bus to speaker_in | OK | allowed | 16 | 0 | allowed | KiCad OK; legitimate wiring |
| bus to speaker_out | OK | allowed | 10 | 0 | allowed | KiCad OK; legitimate wiring |
| bus to supply_in | OK | allowed | 9 | 9 | allowed | KiCad OK; legitimate wiring |
| bus to switch | OK | allowed | 16 | 0 | allowed | KiCad OK; legitimate wiring |
| gpio to ground | OK | finding | 4 | 4 | covered | domain rule (ground short, motor drive) |
| gpio to source | WAR | finding | 2 | 2 | covered | KiCad ERC warning |
| gpio to speaker_in | OK | allowed | 4 | 0 | allowed | KiCad OK; legitimate wiring |
| gpio to speaker_out | OK | allowed | 4 | 0 | allowed | KiCad OK; legitimate wiring |
| gpio to supply_in | OK | gap | 2 | 2 | gap | a GPIO powering a module supply input: pin types are compatible but a GPIO cannot source module current; not modeled |
| gpio to switch | OK | allowed | 3 | 2 | allowed | KiCad OK; legitimate wiring |
| ground to source | OK | finding | 4 | 4 | covered | domain rule (ground short, motor drive) |
| ground to speaker_in | OK | allowed | 6 | 6 | allowed | KiCad OK; legitimate wiring |
| ground to speaker_out | OK | finding | 4 | 4 | covered | domain rule (ground short, motor drive) |
| ground to supply_in | OK | finding | 4 | 4 | covered | domain rule (ground short, motor drive) |
| ground to switch | OK | allowed | 3 | 3 | allowed | KiCad OK; legitimate wiring |
| source to source | ERR | finding | 1 | 1 | covered | KiCad ERC error |
| source to speaker_in | OK | allowed | 4 | 4 | allowed | KiCad OK; legitimate wiring |
| source to speaker_out | ERR | finding | 4 | 4 | covered | KiCad ERC error |
| source to supply_in | OK | allowed | 1 | 1 | allowed | KiCad OK; legitimate wiring |
| source to switch | OK | allowed | 4 | 4 | allowed | KiCad OK; legitimate wiring |
| speaker_in to speaker_out | OK | allowed | 2 | 2 | allowed | KiCad OK; legitimate wiring |
| speaker_in to supply_in | OK | allowed | 4 | 4 | allowed | KiCad OK; legitimate wiring |
| speaker_in to switch | OK | allowed | 4 | 2 | allowed | KiCad OK; legitimate wiring |
| speaker_out to supply_in | OK | allowed | 2 | 2 | allowed | KiCad OK; legitimate wiring |
| speaker_out to switch | OK | allowed | 4 | 2 | allowed | KiCad OK; legitimate wiring |
| supply_in to switch | OK | allowed | 4 | 4 | allowed | KiCad OK; legitimate wiring |

## Connected Water Leak Detector

30 pin pairs · 7 covered kinds · 4 allowed kinds · 4 gap kinds · 0 missed

| Pin roles | KiCad | Expectation | Pairs | Fired | Verdict | Why |
| --- | --- | --- | --- | --- | --- | --- |
| analog_in to ground | OK | gap | 2 | 2 | gap | ADC input grounded: reads zero; intent unknown |
| analog_in to source | OK | gap | 1 | 1 | gap | a supply straight into an ADC input: over-voltage on analog inputs is not modeled |
| analog_in to supply_in | OK | gap | 1 | 1 | gap | not modeled |
| gpio to ground | OK | finding | 4 | 4 | covered | domain rule (ground short, motor drive) |
| gpio to out | OK | allowed | 2 | 0 | allowed | KiCad OK; legitimate wiring |
| gpio to source | WAR | finding | 2 | 2 | covered | KiCad ERC warning |
| gpio to supply_in | OK | gap | 2 | 2 | gap | a GPIO powering a module supply input: pin types are compatible but a GPIO cannot source module current; not modeled |
| ground to out | OK | finding | 2 | 2 | covered | domain rule (ground short, motor drive) |
| ground to source | OK | finding | 4 | 4 | covered | domain rule (ground short, motor drive) |
| ground to supply_in | OK | finding | 4 | 4 | covered | domain rule (ground short, motor drive) |
| out to source | ERR | finding | 2 | 2 | covered | KiCad ERC error |
| out to supply_in | OK | allowed | 1 | 1 | allowed | KiCad OK; legitimate wiring |
| source to source | ERR | finding | 1 | 1 | covered | KiCad ERC error |
| source to supply_in | OK | allowed | 1 | 1 | allowed | KiCad OK; legitimate wiring |
| supply_in to supply_in | OK | allowed | 1 | 1 | allowed | KiCad OK; legitimate wiring |
