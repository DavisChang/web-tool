const autocannon = require('autocannon')
const { request } = require('http')
require('dotenv').config()
const usersData = require('./users.json')

function start() {
  const url = process.env.URL || ('http://localhost:' + (process.env.PORT || 3000))
  const args = process.argv.slice(2)
  console.log('url:', url, '\nargs:', args)

  const numConnections = (args[0] || 1000)
  const maxConnectionRequests = (args[1] || 1000)

  let requestNumber = 0

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
        method: 'POST',
        path: '/api/v1/register',
        setupRequest: function(request) {

          console.log('Request Number: ', requestNumber + 1)
          request.body = JSON.stringify(usersData[requestNumber])
          requestNumber++

          return request;
        }
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