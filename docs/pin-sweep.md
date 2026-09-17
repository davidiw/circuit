# Pin-to-pin connection coverage

Generated 2026-09-17 by `npm run sweep`. Every pin of every part was connected to every pin of every other part, one pair at a time, and the deterministic rules ran on the result.

**This is best effort, and honest about it.** A row marked *covered* means every tested pair of that kind produced a violation or warning. *Allowed* means the wiring is legitimate and silence is correct. *Gap* means the rules say nothing today; the design may still be wrong in that way. The coverage panel in the app lists the dimensions that were evaluated for the same reason: a clean findings list only speaks for what was checked.

## Bluetooth Race Car

634 pin pairs · 16 covered kinds · 14 allowed kinds · 16 gap kinds · 0 missed

| Pin roles | Expectation | Pairs | Fired | Verdict |
| --- | --- | --- | --- | --- |
| anode to cap | gap | 1 | 1 | gap |
| anode to gpio | gap | 11 | 11 | gap |
| anode to ground | allowed | 6 | 6 | allowed |
| anode to logic_in | gap | 7 | 7 | gap |
| anode to motor_in | gap | 4 | 4 | gap |
| anode to motor_out | gap | 4 | 4 | gap |
| anode to source | allowed | 2 | 2 | allowed |
| anode to supply_in | allowed | 4 | 4 | allowed |
| cap to gpio | gap | 11 | 11 | gap |
| cap to ground | allowed | 5 | 5 | allowed |
| cap to logic_in | gap | 7 | 7 | gap |
| cap to motor_in | gap | 4 | 4 | gap |
| cap to motor_out | gap | 4 | 4 | gap |
| cap to out | gap | 1 | 1 | gap |
| cap to source | allowed | 2 | 2 | allowed |
| cap to supply_in | allowed | 2 | 2 | allowed |
| gpio to ground | finding | 55 | 55 | covered |
| gpio to logic_in | allowed | 70 | 0 | allowed |
| gpio to motor_in | finding | 44 | 44 | covered |
| gpio to motor_out | finding | 44 | 44 | covered |
| gpio to out | finding | 11 | 11 | covered |
| gpio to source | finding | 22 | 22 | covered |
| gpio to supply_in | gap | 33 | 33 | gap |
| ground to logic_in | allowed | 35 | 35 | allowed |
| ground to motor_in | finding | 24 | 24 | covered |
| ground to motor_out | finding | 20 | 20 | covered |
| ground to out | finding | 6 | 6 | covered |
| ground to source | finding | 14 | 14 | covered |
| ground to supply_in | finding | 19 | 19 | covered |
| logic_in to motor_in | gap | 28 | 28 | gap |
| logic_in to out | allowed | 7 | 7 | allowed |
| logic_in to source | allowed | 21 | 21 | allowed |
| logic_in to supply_in | gap | 14 | 14 | gap |
| motor_in to motor_in | finding | 4 | 4 | covered |
| motor_in to motor_out | allowed | 12 | 12 | allowed |
| motor_in to out | gap | 4 | 4 | gap |
| motor_in to source | finding | 12 | 12 | covered |
| motor_in to supply_in | gap | 16 | 16 | gap |
| motor_out to out | finding | 4 | 4 | covered |
| motor_out to source | finding | 12 | 12 | covered |
| motor_out to supply_in | gap | 8 | 8 | gap |
| out to source | finding | 3 | 3 | covered |
| out to supply_in | allowed | 3 | 3 | allowed |
| source to source | finding | 3 | 3 | covered |
| source to supply_in | allowed | 7 | 7 | allowed |
| supply_in to supply_in | allowed | 4 | 4 | allowed |

## Connected Video Doorbell

177 pin pairs · 7 covered kinds · 5 allowed kinds · 18 gap kinds · 0 missed

| Pin roles | Expectation | Pairs | Fired | Verdict |
| --- | --- | --- | --- | --- |
| bus to bus | allowed | 15 | 0 | allowed |
| bus to gpio | gap | 8 | 0 | gap |
| bus to ground | gap | 17 | 0 | gap |
| bus to source | gap | 12 | 0 | gap |
| bus to speaker_in | gap | 16 | 0 | gap |
| bus to speaker_out | gap | 10 | 0 | gap |
| bus to supply_in | gap | 9 | 0 | gap |
| bus to switch | gap | 16 | 0 | gap |
| gpio to ground | finding | 4 | 4 | covered |
| gpio to source | finding | 2 | 2 | covered |
| gpio to speaker_in | gap | 4 | 4 | gap |
| gpio to speaker_out | gap | 4 | 4 | gap |
| gpio to supply_in | gap | 2 | 2 | gap |
| gpio to switch | allowed | 3 | 2 | allowed |
| ground to source | finding | 4 | 4 | covered |
| ground to speaker_in | gap | 6 | 6 | gap |
| ground to speaker_out | finding | 4 | 4 | covered |
| ground to supply_in | finding | 4 | 4 | covered |
| ground to switch | allowed | 3 | 3 | allowed |
| source to source | finding | 1 | 1 | covered |
| source to speaker_in | gap | 4 | 4 | gap |
| source to speaker_out | finding | 4 | 4 | covered |
| source to supply_in | allowed | 1 | 1 | allowed |
| source to switch | gap | 4 | 4 | gap |
| speaker_in to speaker_out | allowed | 2 | 2 | allowed |
| speaker_in to supply_in | gap | 4 | 4 | gap |
| speaker_in to switch | gap | 4 | 4 | gap |
| speaker_out to supply_in | gap | 2 | 2 | gap |
| speaker_out to switch | gap | 4 | 4 | gap |
| supply_in to switch | gap | 4 | 4 | gap |

## Connected Water Leak Detector

30 pin pairs · 8 covered kinds · 3 allowed kinds · 4 gap kinds · 0 missed

| Pin roles | Expectation | Pairs | Fired | Verdict |
| --- | --- | --- | --- | --- |
| analog_in to ground | gap | 2 | 2 | gap |
| analog_in to source | gap | 1 | 1 | gap |
| analog_in to supply_in | gap | 1 | 1 | gap |
| gpio to ground | finding | 4 | 4 | covered |
| gpio to out | finding | 2 | 2 | covered |
| gpio to source | finding | 2 | 2 | covered |
| gpio to supply_in | gap | 2 | 2 | gap |
| ground to out | finding | 2 | 2 | covered |
| ground to source | finding | 4 | 4 | covered |
| ground to supply_in | finding | 4 | 4 | covered |
| out to source | finding | 2 | 2 | covered |
| out to supply_in | allowed | 1 | 1 | allowed |
| source to source | finding | 1 | 1 | covered |
| source to supply_in | allowed | 1 | 1 | allowed |
| supply_in to supply_in | allowed | 1 | 1 | allowed |
