'use strict';

const {
  submitRequest,
  listRequests,
  getMyRequests,
  approveRequest,
  rejectRequest,
  exportRequestHtml,
} = require('./service');
const { sendSuccess } = require('../../utils/response');
const { logAction } = require('../../utils/auditLogger');

async function submitRequestEntry(req, res, next) {
  try {
    const request = await submitRequest(req.user, req.body);
    await logAction(req.user._id, 'BUS_REQUEST_SUBMITTED', 'BusTripRequest', request._id, {
      destination: req.body.destination,
      preferredDate: req.body.preferredDate,
    }, req.ip);
    return sendSuccess(res, request, 'Bus trip request submitted', 201);
  } catch (err) {
    return next(err);
  }
}

async function listRequestsEntry(req, res, next) {
  try {
    const requests = await listRequests({ status: req.query.status });
    return sendSuccess(res, requests, 'Requests retrieved');
  } catch (err) {
    return next(err);
  }
}

async function getMyRequestsEntry(req, res, next) {
  try {
    const requests = await getMyRequests(req.user._id);
    return sendSuccess(res, requests, 'Your requests retrieved');
  } catch (err) {
    return next(err);
  }
}

async function approveRequestEntry(req, res, next) {
  try {
    const request = await approveRequest(req.user, req.params.id);
    await logAction(req.user._id, 'BUS_REQUEST_APPROVED', 'BusTripRequest', request._id, {}, req.ip);
    return sendSuccess(res, request, 'Request approved');
  } catch (err) {
    return next(err);
  }
}

async function rejectRequestEntry(req, res, next) {
  try {
    const request = await rejectRequest(req.user, req.params.id, req.body.reason);
    await logAction(req.user._id, 'BUS_REQUEST_REJECTED', 'BusTripRequest', request._id, { reason: req.body.reason }, req.ip);
    return sendSuccess(res, request, 'Request rejected');
  } catch (err) {
    return next(err);
  }
}

async function exportRequestEntry(req, res, next) {
  try {
    const html = await exportRequestHtml(req.params.id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  submitRequestEntry,
  listRequestsEntry,
  getMyRequestsEntry,
  approveRequestEntry,
  rejectRequestEntry,
  exportRequestEntry,
};
