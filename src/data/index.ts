import { Registry, Project, type Registry as RegistryT, type Project as ProjectT, type RegistryComponent } from '../model/schema';
import registryJson from './registry.json';
import raceCar from './templates/race_car_bt_v1.json';
import doorbell from './templates/video_doorbell_v1.json';
import leak from './templates/water_leak_detector_v1.json';

export const registry: RegistryT = Registry.parse(registryJson);
export const templates: ProjectT[] = [raceCar, doorbell, leak].map((t) => Project.parse(t));

export function getTemplate(id: string): ProjectT | undefined {
  return templates.find((t) => t.id === id);
}

export function component(registryId: string): RegistryComponent | undefined {
  return registry.components.find((c) => c.id === registryId);
}

/** Deep clone so UI state never aliases the frozen template. */
export function freshProject(id: string): ProjectT {
  const t = getTemplate(id);
  if (!t) throw new Error(`unknown template ${id}`);
  return structuredClone(t);
}
