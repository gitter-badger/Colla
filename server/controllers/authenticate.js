const HTTPError = require('http-errors')
const Promise = require('bluebird')
const jwt = require('jwt-simple')
const argon2 = require('argon2')
const mongodb = require('../adapters/mongodb')
const userCollection = require('../models/user').collection
const roleCollection = require('../models/role').collection
const pkg = require('../../package.json')

const controller = {
  /**
   * Retrieves permissions from roles
   * @param {Array} roles The array of roles assigned to user
   * @returns {Object.<promise>}
   */
  getPermissions: (roles) => Promise.reduce(roles, (acc, role) => {
    return mongodb.read(roleCollection, { name: role })
      .then((results) => {
        /* istanbul ignore next */
        return results.length ? acc.concat(results[0].permissions) : acc
      })
  }, []),
  /**
   * Verifies authentication information in event.body and either responds
   * with 403 error on failure or 200 with JWT body
   * @param {Object} event The request event object
   * @returns {Object.<promise>}
   */
  authenticate: (event) => Promise.resolve().then(() => {
    const salt = new Buffer(process.env.AUTH_PASSWORD_SALT)
    return mongodb.read(userCollection, { email: event.body.email })
      .then((res) => {
        // Check user exists
        if (res.length === 0) {
          throw new HTTPError(403, 'Invalid email address')
        }
        // Check valid password
        return argon2.hash(event.body.password, salt)
          .then((hashedPassword) => {
            if (hashedPassword !== res[0].password) {
              throw new HTTPError(403, 'Invalid password')
            }
            return
          })
          .then(() => controller.getPermissions(res[0].roles))
          .then((permissions) => {
            // Everything checks out, return JWT
            return jwt.encode({
              iss: pkg.name,
              exp: Date.now() + process.env.AUTH_JWT_EXPIRES,
              context: {
                id: res[0]._id,
                permissions
              }
            }, process.env.AUTH_JWT_SECRET)
          })
      })
  }),
  /**
   * Verifies authentication by decoding JWT and returning
   * 403 (on fail) or array of permissions (on success)
   * @param {Object} event The request event object
   * @returns {Object.<Promise>}
   */
  verify: (event) => Promise.resolve().then(() => {
    if (!event.headers.authorization) throw new HTTPError(403, 'Not Authenticated')
    // Get token
    let token
    try {
      token = jwt.decode(event.headers.authorization, process.env.AUTH_JWT_SECRET)
    } catch (e) {
      throw new HTTPError(403, 'Invalid Token')
    }
    // Verify issuer
    if (token.iss !== pkg.name) throw new HTTPError(403, 'Invalid Token')
    // Verify expiration
    if (token.exp <= Date.now()) throw new HTTPError(403, 'Token Expired')
    // Return array of permissions
    return token.context.permissions
  })
}

module.exports = controller
