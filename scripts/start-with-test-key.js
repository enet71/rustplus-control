if (!process.env.APP_AUTH_TOKEN) {
  process.env.APP_AUTH_TOKEN = 'rust-control-local-test';
}

require('../server');
