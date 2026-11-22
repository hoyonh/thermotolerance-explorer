// Which data fields the current Color / compare and Arrange panels already keep apart (so a "pooled across" warning must not name them).
// The combined 'source_config' panel arrangement separates both the source and the configuration.
export function separatedFields(s) {
  return new Set([s.group, s.facet, ...(s.facet === 'source_config' ? ['source', 'config'] : [])]);
}
