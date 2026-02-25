import crypto from 'crypto';

import type { SimulateMode } from '../../schemas/simulate';
import { ingestEvents } from '../ingest/ingest';
import { generateEvents } from './generator';
import type { GameScope } from '../../auth/types';

export type SimulationState = {
  id: string;
  status: 'running' | 'done' | 'error';
  mode: SimulateMode;
  totalEvents: number;
  fpsMatches: number;
  sent: number;
  accepted: number;
  rejected: number;
  errors: number;
  rate: number;
  batchSize: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

const simulations = new Map<string, SimulationState>();

export function startSimulation(config: {
  scope: GameScope;
  mode: SimulateMode;
  totalEvents: number;
  fpsMatches: number;
  rate: number;
  batchSize: number;
}): SimulationState {
  const id = crypto.randomUUID();
  const state: SimulationState = {
    id,
    status: 'running',
    mode: config.mode,
    totalEvents: config.totalEvents,
    fpsMatches: config.fpsMatches,
    sent: 0,
    accepted: 0,
    rejected: 0,
    errors: 0,
    rate: config.rate,
    batchSize: config.batchSize,
    startedAt: new Date().toISOString(),
  };

  simulations.set(id, state);
  void runSimulation(state, config);
  scheduleCleanup(id);

  return state;
}

export function getSimulation(id: string): SimulationState | undefined {
  return simulations.get(id);
}

async function runSimulation(
  state: SimulationState,
  config: {
    scope: GameScope;
    mode: SimulateMode;
    totalEvents: number;
    fpsMatches: number;
    rate: number;
    batchSize: number;
  },
) {
  try {
    const events = generateEvents({
      totalEvents: config.totalEvents,
      fpsMatches: config.fpsMatches,
      mode: config.mode,
    });
    let index = 0;
    while (index < events.length) {
      const slice = events.slice(index, index + config.rate);
      for (let i = 0; i < slice.length; i += config.batchSize) {
        const chunk = slice.slice(i, i + config.batchSize);
        const result = await ingestEvents(config.scope, chunk);
        state.sent += chunk.length;
        state.accepted += result.accepted;
        state.rejected += result.rejected;
        state.errors += result.errors ?? 0;
      }
      index += slice.length;
      if (index < events.length) {
        await sleep(1000);
      }
    }
    state.status = 'done';
    state.finishedAt = new Date().toISOString();
  } catch (error) {
    state.status = 'error';
    state.error = error instanceof Error ? error.message : 'unknown error';
    state.finishedAt = new Date().toISOString();
  }
}

function scheduleCleanup(id: string) {
  setTimeout(() => {
    simulations.delete(id);
  }, 60 * 60 * 1000).unref?.();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
