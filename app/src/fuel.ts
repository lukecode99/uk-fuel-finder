import { FuelCode } from './types';

export const FUELS: { code: FuelCode; label: string; short: string }[] = [
  { code: 'E10', label: 'Petrol (E10)', short: 'E10' },
  { code: 'E5', label: 'Super (E5)', short: 'E5' },
  { code: 'B7', label: 'Diesel (B7)', short: 'Diesel' },
  { code: 'SDV', label: 'Premium diesel', short: 'Premium' },
];

export const fuelLabel = (code: FuelCode) =>
  FUELS.find(f => f.code === code)?.label ?? code;
