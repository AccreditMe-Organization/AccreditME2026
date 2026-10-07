export const environment = {
  production: true,
  // PLACEHOLDER — where the API is served in production is not decided yet
  // (ACC-130, ACC-148). Same-origin '/api/v1' is a guess, not a decision;
  // replace it when those tickets settle it.
  apiUrl: '/api/v1',
  // Every organisation signs in at {slug}.accreditme.app (ACC-139).
  baseDomain: 'accreditme.app',
};
