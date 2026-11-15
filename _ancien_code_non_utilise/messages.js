export function formatPlaceholders(str, { user, level }) {
  return str
    .replaceAll('{user}', user ?? 'Utilisateur')
    .replaceAll('{level}', String(level ?? '0'));
}
