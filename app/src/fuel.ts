import { FuelCode } from './types';

export const FUELS: { code: FuelCode; label: string; short: string; sub: string }[] = [
  { code: 'E10', label: 'Petrol', short: 'Petrol', sub: 'E10' },
  { code: 'E5', label: 'Super Unleaded', short: 'Super Unl.', sub: 'E5' },
  { code: 'B7', label: 'Diesel', short: 'Diesel', sub: 'B7' },
  { code: 'SDV', label: 'Super Diesel', short: 'Sup. Diesel', sub: 'SDV' },
];

export const fuelLabel = (code: FuelCode) =>
  FUELS.find(f => f.code === code)?.label ?? code;
