'use strict'
// const _ = require('lodash')
const thunk = require('thunks')()
const Mysql = require('mysql')
// const mysql = require('../service/mysql')
const debug = require('debug')('db')

const COMPARE_SYMBOLS = ['=', '>', '<', '<>', '!=', '>=', '<=', 'LIKE']
const OPERATION_SYMBOLS = ['+', '-', '*']

module.exports = DB
function DB (mysql, options) {
  if (!(this instanceof DB)) return new DB(mysql, options)
  options = options || {}
  this.mysql = mysql
  this.query = thunk.thunkify(mysql.query).bind(mysql)
  this.prefix = mysql.prefix || options.prefix
}

DB.prototype.find = function *(table, conds, options) {
  conds = conds || {}
  options = options || {}
  let sql_cond = this.makeCoditionField(table, conds, 'AND')
  let fields = options.fields || '*'
  let sql = `SELECT ${fields} FROM \`${this.prefix}_${table}\``
  if (options.joins && options.joins.length) {
    options.joins.map(function (join) {
      if (!join.cond || !join.cond.length) throw new Error('No join Condition')
      sql += ` ${join.type || 'INNER'} JOIN ${this.prefix}_${join.table}`
      sql += ` ON ${join.cond.join(' AND ')}`
    })
  }
  if (sql_cond) sql += ` WHERE ${sql_cond}`
  if (options.sort) sql += ` ORDER BY ${options.sort}`
  if (options.pagesize > 0) {
    let page = options.page > 0 ? options.page : 1
    sql += ` LIMIT ${(page - 1) * options.pagesize}, ${options.pagesize}`
  }
  debug('query: %s', sql)
  options.sql = sql
  let result = yield this.query(options)
  return result[0]
}

DB.prototype.update = function *(table, id, object, options) {
  object = object || {}
  options = options || {}
  let sql_update = this.makeUpdateSql(table, object)
  if (!sql_update) throw new Error('no update set')
  let sql = `UPDATE \`${this.prefix}_${table}\` SET ${sql_update} WHERE id=${Mysql.escape(id)}`
  debug('query: %s', sql)
  options.sql = sql
  let result = yield this.query(options)
  return result
}

DB.prototype.insert = function *(table, object, options) {
  object = object || {}
  options = options || {}
  let sql_insert = this.makeUpdateSql(table, object)
  if (!sql_insert) throw new Error('no insert set')
  let sql = `INSERT INTO \`${this.prefix}_${table}\` SET ${sql_insert}`
  debug('mysql query: %s', sql)
  options.sql = sql
  let result = yield this.query(options)
  return result
}

/*
  support conds like these:
  {A:a, B:b} => WHERE A=a AND B=b
  {$OR:{A:a, B:b}, C:c} => WHERE (A=a OR B=b) AND C=c
  {A$IN:[a1,a2,a3], B$>: b, C$LIKE: c} => WHERE A in (a1,a2,a3) AND B>b AND C LIKE %c%
*/

DB.prototype.makeCoditionField = function (table, conds, joiner) {
  joiner = joiner || 'AND'
  let result = []
  for (let key in conds) {
    let cond
    let value = conds[key]
    let field, op
    let tmp = key.split('$')
    field = tmp[0]
    op = tmp[1] || '='
    op = op.trim().toUpperCase()
    if (op === 'AND' || op === 'OR') {
      if (!Object.keys(value).length) throw new Error('mysql: AND need an object with key length > 0')
      cond = '(' + this.makeCoditionField(table, value, op) + ')'
    } else if (COMPARE_SYMBOLS.indexOf(op) !== -1) {
      cond = `\`${this.prefix}_${table}\`.\`${field}\` ${op} ${Mysql.escape(value)}`
    } else if (op === 'IN') {
      if (!Array.isArray(value)) throw new Error('mysql: IN need Array ' + value)
      let values = value.map((one) => Mysql.escape(value)).join(', ')
      cond = `\`${this.prefix}_${table}\`.\`${field}\` ${op} (${values})`
    } else {
      throw new Error('mysql: Unknown op: ' + op)
    }
    result.push(cond)
  }
  return result.join(` ${joiner} `)
}

DB.prototype.makeUpdateSql = function (table, object) {
  let result = []
  for (let key in object) {
    let phase = ''
    let tmp = key.split('$')
    let field = tmp[0]
    let op = tmp[1] || '='
    if (op === '=') {
      phase = `\`${field}\` = ${Mysql.escape(object[key])}`
    } else if (OPERATION_SYMBOLS.indexOf(op) !== -1) {
      phase = `\`${field}\` = \`${field}\` ${op} ${Mysql.escape(object[key])}`
    } else {
      throw new Error('mysql: Unkonwn op: ' + op)
    }
    result.push(phase)
  }
  return result.join(', ')
}