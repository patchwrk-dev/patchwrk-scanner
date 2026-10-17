import type { ChangeClassification } from '../types/changes.ts';
import { validateChange } from './validation.ts';

export function classifyChange(input: unknown): ChangeClassification {
  const change = validateChange(input);
  const verificationStatus = change.verification.status;
  const basis = verificationStatus === 'illustrative' ? 'illustrative'
    : verificationStatus === 'unverified' ? 'unverified'
      : change.category === 'unknown' ? 'insufficient-evidence' : 'reviewed-official-metadata';
  return {
    category: basis === 'reviewed-official-metadata' ? change.category : 'unknown',
    declaredCategory: change.category, verificationStatus, basis,
  };
}
