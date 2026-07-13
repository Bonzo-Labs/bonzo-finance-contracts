export function recordRateUpdateStep(
  state: any,
  symbol: string,
  phase: 'deploy' | 'wire',
  data: Record<string, unknown>,
  archivedAt = new Date().toISOString()
) {
  state.reserves = state.reserves || {};
  state.reserves[symbol] = state.reserves[symbol] || {};

  if (phase === 'deploy') {
    const previous = state.reserves[symbol];
    const history = Array.isArray(previous.history) ? [...previous.history] : [];
    if (previous.deploy || previous.wire) {
      history.push({
        archivedAt,
        deploy: previous.deploy,
        wire: previous.wire,
      });
    }
    state.reserves[symbol] = { history, deploy: { ...data, completed: true } };
  } else {
    state.reserves[symbol].wire = { ...data, completed: true };
  }

  return state;
}
