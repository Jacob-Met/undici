'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { createServer } = require('node:http')
const { once } = require('node:events')
const { Agent, fetch } = require('..')

// https://github.com/nodejs/undici/issues/6204
for (const connections of [undefined, 1]) {
  for (const cancellation of ['cancel', 'abort']) {
    test(`Agent releases origin slots after ${cancellation} (connections: ${connections ?? 'pool'})`, { timeout: 10000 }, async (t) => {
      const agent = new Agent({ connections, maxOrigins: 1 })
      const servers = await Promise.all(Array.from({ length: 5 }, () => new Promise(resolve => {
        const server = createServer((_req, res) => {
          res.writeHead(200)
          res.write('x'.repeat(64 * 1024))
        })
        server.listen(0, '127.0.0.1', () => resolve(server))
      })))

      t.after(async () => {
        await agent.destroy()
        for (const server of servers) {
          server.closeAllConnections()
          await new Promise(resolve => server.close(resolve))
        }
      })

      for (const server of servers) {
        const controller = new AbortController()
        const disconnected = once(agent, 'disconnect')
        const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {
          dispatcher: agent,
          signal: controller.signal
        })
        if (cancellation === 'abort') {
          await response.body.getReader().read()
          controller.abort()
        } else {
          await response.body.cancel()
        }
        await disconnected
        assert.equal(Object.keys(agent.stats).length, 0)
      }
    })
  }
}
