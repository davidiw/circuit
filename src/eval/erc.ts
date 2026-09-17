import type { PinRole } from '../model/schema';

/**
 * Pin-type conflict matrix imported from KiCad's default ERC settings (erc_settings.cpp, defaultPinMap), the de facto
 * exhaustive list of which pin electrical types may share a net. Our pin roles map onto KiCad's types below; domain rules
 * (shorts to ground, motors on GPIOs, voltage ranges) sit on top. Source: https://docs.kicad.org/doxygen/erc__settings_8cpp_source.html
 */
export type KicadType = 'I' | 'O' | 'Bi' | '3S' | 'Pas' | 'NIC' | 'UnS' | 'PwrI' | 'PwrO' | 'OC' | 'OE' | 'NC';
export const KICAD_TYPES: KicadType[] = ['I', 'O', 'Bi', '3S', 'Pas', 'NIC', 'UnS', 'PwrI', 'PwrO', 'OC', 'OE', 'NC'];
export const KICAD_TYPE_NAME: Record<KicadType, string> = { I: 'input', O: 'output', Bi: 'bidirectional', '3S': 'tri-state', Pas: 'passive', NIC: 'not internally connected', UnS: 'unspecified', PwrI: 'power input', PwrO: 'power output', OC: 'open collector', OE: 'open emitter', NC: 'no connect' };
type V = 'OK' | 'WAR' | 'ERR';
const M: V[][] = [
  /* I    */ ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'WAR', 'OK', 'OK', 'OK', 'OK', 'ERR'],
  /* O    */ ['OK', 'ERR', 'OK', 'WAR', 'OK', 'OK', 'WAR', 'OK', 'ERR', 'ERR', 'ERR', 'ERR'],
  /* Bi   */ ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'WAR', 'OK', 'WAR', 'OK', 'WAR', 'ERR'],
  /* 3S   */ ['OK', 'WAR', 'OK', 'OK', 'OK', 'OK', 'WAR', 'WAR', 'ERR', 'WAR', 'WAR', 'ERR'],
  /* Pas  */ ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'WAR', 'OK', 'OK', 'OK', 'OK', 'ERR'],
  /* NIC  */ ['OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'OK', 'ERR'],
  /* UnS  */ ['WAR', 'WAR', 'WAR', 'WAR', 'WAR', 'OK', 'WAR', 'WAR', 'WAR', 'WAR', 'WAR', 'ERR'],
  /* PwrI */ ['OK', 'OK', 'OK', 'WAR', 'OK', 'OK', 'WAR', 'OK', 'OK', 'OK', 'OK', 'ERR'],
  /* PwrO */ ['OK', 'ERR', 'WAR', 'ERR', 'OK', 'OK', 'WAR', 'OK', 'ERR', 'ERR', 'ERR', 'ERR'],
  /* OC   */ ['OK', 'ERR', 'OK', 'WAR', 'OK', 'OK', 'WAR', 'OK', 'ERR', 'OK', 'OK', 'ERR'],
  /* OE   */ ['OK', 'ERR', 'WAR', 'WAR', 'OK', 'OK', 'WAR', 'OK', 'ERR', 'OK', 'OK', 'ERR'],
  /* NC   */ ['ERR', 'ERR', 'ERR', 'ERR', 'ERR', 'ERR', 'ERR', 'ERR', 'ERR', 'ERR', 'ERR', 'ERR'],
];
export function kicadVerdict(a: KicadType, b: KicadType): V { return M[KICAD_TYPES.indexOf(a)][KICAD_TYPES.indexOf(b)]; }

/** Our pin roles in KiCad's vocabulary. A battery negative or module ground pin is a power input in ERC terms (the GND flag is a power input in KiCad). */
export const ROLE_TO_KICAD: Record<PinRole, KicadType> = {
  supply_out: 'PwrO', battery_pos: 'PwrO', supply_in: 'PwrI', ground: 'PwrI',
  logic_in: 'I', enable_in: 'I', analog_in: 'I', logic_out: 'O', analog_out: 'O', motor_out: 'O', speaker_out: 'O',
  gpio: 'Bi', csi: 'Bi', i2s: 'Bi', cap_pos: 'Pas', anode: 'Pas', cathode: 'Pas', motor_in: 'Pas', speaker_in: 'Pas', switch: 'Pas',
};
