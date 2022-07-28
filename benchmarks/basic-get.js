const autocannon = require('autocannon')
require('dotenv').config()

function start() {
  const url = process.env.URL || ('http://localhost:' + (process.env.PORT || 3000))
  const args = process.argv.slice(2)
  console.log('url:', url, '\nargs:', args)

  const numConnections = (args[0] || 1000)
  const maxConnectionRequests = (args[1] || 1000)

  const instance = autocannon({
    url,
    connections: numConnections,
    duration: 10,
    maxConnectionRequests,
    headers: {
      'content-type': 'application/json'
    },
    requests: [
      {
        method: 'GET',
        path: '/'
      }
    ]
  },finished)

  // tracking
  autocannon.track(instance)

  function finished(error, res) {
    console.log('finished: ', error, res)
  }
}

start()