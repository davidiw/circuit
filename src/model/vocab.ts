/** Controlled vocabularies. Kept as data so a Dart port and the AI output gate share them. */
export const REQUIREMENT_KINDS = [
  'capability', 'motor_count', 'h_bridge_per_motor', 'pwm_speed_control', 'power_mode', 'runtime_minutes',
  'video', 'audio_output', 'motion_detection', 'streaming_latency', 'standby_life', 'envelope', 'enclosure', 'build_mode', 'exclusion',
] as const;

export const FINDING_CATEGORIES = [
  'power', 'reference', 'voltage', 'load_path', 'control_state', 'protection', 'transients', 'current', 'requirement', 'budget', 'runtime',
  'power_path', 'performance', 'thermal', 'emi', 'firmware', 'mechanical', 'other',
] as const;

export const COVERAGE_DIMENSIONS = {
  electrical: [
    'power_source', 'signal_reference', 'rail_voltages', 'driver_control_state', 'motor_wiring', 'driver_motor_current',
    'reverse_polarity', 'regulator_headroom', 'decoupling', 'regulator_current_thermal', 'bulk_capacitance', 'transients_emi', 'thermal', 'physical_layout',
  ],
  product: ['product_requirements', 'runtime', 'size_envelope', 'streaming_latency', 'standby_life'],
} as const;

/** Dimensions relevant to every design; listed as not evaluated when no analyzer covers them. */
export const UNIVERSAL_DIMENSIONS = ['transients_emi', 'thermal', 'physical_layout'] as const;

/** Facts an analyzer depends on, per component kind. Missing ones make the registry test flag the entry as incomplete. */
export const EXPECTED_FACTS: Record<string, string[]> = {
  motor_driver: ['continuous_current_per_channel_a', 'h_bridge_channels'],
  dc_gearmotor: ['nominal_v', 'stall_current_a'],
  buck_module_class: ['continuous_output_a', 'dropout_v'],
  battery_class: ['nominal_v', 'min_usable_v', 'full_charge_v'],
  schottky_diode: ['forward_current_a', 'forward_drop_v'],
  capacitor_class: ['capacitance_uf'],
};
