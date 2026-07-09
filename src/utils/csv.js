'use strict';

const BOM = '﻿';

function escapeCsvValue(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts an array of records into a CSV string.
 * @param {object[]} rows - Source records.
 * @param {{label: string, value: string|((row: object) => *)}[]} columns
 * @returns {string}
 */
function toCSV(rows, columns) {
  const header = columns.map((c) => escapeCsvValue(c.label)).join(',');
  const lines = rows.map((row) =>
    columns
      .map((c) => escapeCsvValue(typeof c.value === 'function' ? c.value(row) : row[c.value]))
      .join(',')
  );

  return [header, ...lines].join('\r\n');
}

/**
 * Wraps a CSV string so Excel opens it correctly no matter the system locale:
 * a UTF-8 BOM keeps accented characters readable, and the `sep=,` directive
 * tells Excel to split columns on commas even where the regional list
 * separator is a semicolon (otherwise the whole row lands in column A).
 * @param {object[]} rows
 * @param {{label: string, value: string|((row: object) => *)}[]} columns
 * @returns {string}
 */
function toExcelCSV(rows, columns) {
  return `${BOM}sep=,\r\n${toCSV(rows, columns)}`;
}

/**
 * Sends CSV content as a downloadable file attachment, formatted for Excel.
 * @param {import('express').Response} res
 * @param {string} filename
 * @param {object[]} rows
 * @param {{label: string, value: string|((row: object) => *)}[]} columns
 */
function sendCsv(res, filename, rows, columns) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(toExcelCSV(rows, columns));
}

module.exports = { toCSV, toExcelCSV, sendCsv };
