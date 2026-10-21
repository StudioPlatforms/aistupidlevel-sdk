const authentication = require('./authentication');
const { addAuth, handleErrors } = require('./lib/middleware');
const routingModes = require('./triggers/routing_modes');
const sendPrompt = require('./creates/send_prompt');
const previewRoute = require('./creates/preview_route');
const leaderboard = require('./searches/leaderboard');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication,
  beforeRequest: [addAuth],
  afterResponse: [handleErrors],
  triggers: { [routingModes.key]: routingModes },
  creates: { [sendPrompt.key]: sendPrompt, [previewRoute.key]: previewRoute },
  searches: { [leaderboard.key]: leaderboard },
};
