'use strict';

const BusTripRequest = require('../../models/BusTripRequest');
const { notify, notifyRoles } = require('../../utils/notifier');

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/* ── Submit a new request (FACULTY) ──────────────────────────────────────── */

async function submitRequest(user, { route, origin, destination, preferredDate, preferredDepartureTime, numberOfPassengers, purpose, notes }) {
  if (!destination) throw httpError('destination is required', 400);
  if (!preferredDate) throw httpError('preferredDate is required', 400);
  if (!preferredDepartureTime) throw httpError('preferredDepartureTime is required', 400);
  if (!numberOfPassengers || numberOfPassengers < 1) throw httpError('numberOfPassengers must be at least 1', 400);
  if (!purpose) throw httpError('purpose is required', 400);

  const parsedDate = new Date(preferredDate);
  if (Number.isNaN(parsedDate.getTime())) throw httpError('preferredDate must be a valid date', 400);

  const request = await BusTripRequest.create({
    requester:              user._id,
    requesterName:          user.fullName,
    requesterEmail:         user.email,
    route:                  route || undefined,
    origin:                 origin || 'Main Campus',
    destination,
    preferredDate:          parsedDate,
    preferredDepartureTime,
    numberOfPassengers,
    purpose,
    notes:                  notes || undefined,
  });

  await notifyRoles(['BUS_MANAGER'], {
    title: 'New bus trip request',
    message: `${user.fullName} has submitted a bus trip request to ${destination} on ${parsedDate.toLocaleDateString()}.`,
    type: 'BUS_REQUEST_SUBMITTED',
    entityType: 'BusTripRequest',
    entityId: request._id,
  });

  return request;
}

/* ── List all requests (BUS_MANAGER) ─────────────────────────────────────── */

async function listRequests({ status } = {}) {
  const query = {};
  if (status) query.status = status;
  return BusTripRequest.find(query)
    .populate('route', 'name origin destination')
    .populate('reviewedBy', 'fullName')
    .sort({ createdAt: -1 })
    .lean();
}

/* ── Faculty's own requests ───────────────────────────────────────────────── */

async function getMyRequests(userId) {
  return BusTripRequest.find({ requester: userId })
    .populate('route', 'name origin destination')
    .sort({ createdAt: -1 })
    .lean();
}

/* ── Internal helper ──────────────────────────────────────────────────────── */

async function getRequestOrThrow(id) {
  const req = await BusTripRequest.findById(id)
    .populate('route', 'name origin destination')
    .populate('reviewedBy', 'fullName');
  if (!req) throw httpError('Bus trip request not found', 404);
  return req;
}

/* ── Approve (BUS_MANAGER) ───────────────────────────────────────────────── */

async function approveRequest(user, id) {
  const req = await getRequestOrThrow(id);
  if (req.status !== 'PENDING') throw httpError(`Cannot approve a request with status ${req.status}`, 400);

  req.status = 'APPROVED';
  req.reviewedAt = new Date();
  req.reviewedBy = user._id;
  await req.save();

  await notify(req.requester, {
    title: 'Bus trip request approved',
    message: `Your bus trip request to ${req.destination} on ${new Date(req.preferredDate).toLocaleDateString()} has been approved.`,
    type: 'BUS_REQUEST_APPROVED',
    entityType: 'BusTripRequest',
    entityId: req._id,
  });

  return req;
}

/* ── Reject (BUS_MANAGER) ────────────────────────────────────────────────── */

async function rejectRequest(user, id, reason) {
  if (!reason) throw httpError('A rejection reason is required', 400);
  const req = await getRequestOrThrow(id);
  if (req.status !== 'PENDING') throw httpError(`Cannot reject a request with status ${req.status}`, 400);

  req.status = 'REJECTED';
  req.rejectionReason = reason;
  req.reviewedAt = new Date();
  req.reviewedBy = user._id;
  await req.save();

  await notify(req.requester, {
    title: 'Bus trip request not approved',
    message: `Your bus trip request to ${req.destination} was not approved. Reason: ${reason}`,
    type: 'BUS_REQUEST_REJECTED',
    entityType: 'BusTripRequest',
    entityId: req._id,
  });

  return req;
}

/* ── Export: printable HTML form ─────────────────────────────────────────── */

async function exportRequestHtml(id) {
  const req = await getRequestOrThrow(id);

  const ref       = `REQ-${req._id.toString().slice(-6).toUpperCase()}`;
  const submitted = new Date(req.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const prefDate  = new Date(req.preferredDate).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const routeLabel = req.route
    ? `${req.route.name} (${req.route.origin} → ${req.route.destination})`
    : `${req.origin} → ${req.destination}`;

  const statusColors = { PENDING: '#92400e;background:#fef3c7', APPROVED: '#065f46;background:#d1fae5', REJECTED: '#991b1b;background:#fee2e2' };
  const sc = statusColors[req.status] || '#333;background:#f3f4f6';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bus Trip Request — ${ref}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:13px;color:#1a1a1a;padding:48px;max-width:820px;margin:0 auto}
    .hdr{text-align:center;border-bottom:3px solid #1a1a1a;padding-bottom:18px;margin-bottom:28px}
    .hdr .org{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#555;margin-bottom:6px}
    .hdr h1{font-size:22px;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px}
    .hdr .ref{font-size:12px;color:#666}
    .sec{margin-bottom:22px}
    .sec h2{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#555;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:12px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 28px}
    .field .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:2px}
    .field .val{font-size:13px;font-weight:600;border-bottom:1px solid #ccc;padding:3px 0 5px;min-height:24px}
    .box{border:1px solid #ccc;padding:10px 12px;min-height:64px;border-radius:2px;line-height:1.6}
    .badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${sc.split(';background:')[0]};background:${sc.split(';background:')[1]}}
    .sig-row{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:52px}
    .sig-box{border-top:2px solid #1a1a1a;padding-top:10px}
    .sig-box .ttl{font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin-bottom:36px}
    .sig-line{border-bottom:1px solid #999;height:28px;margin-bottom:6px}
    .sig-label{font-size:10px;color:#888;letter-spacing:.5px;text-transform:uppercase}
    .stamp{border:1px dashed #bbb;height:90px;margin-top:14px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#bbb;letter-spacing:2px;text-transform:uppercase}
    .print-btn{margin-top:36px;display:block;width:100%;padding:13px;font-size:14px;cursor:pointer;background:#1a1a1a;color:#fff;border:none;border-radius:4px;letter-spacing:.5px}
    @media print{.print-btn{display:none}body{padding:24px}}
  </style>
</head>
<body>
  <div class="hdr">
    <div class="org">Campus Resource Management System</div>
    <h1>Bus Trip Request Form</h1>
    <div class="ref">Reference: <strong>${ref}</strong> &nbsp;·&nbsp; Submitted: ${submitted}</div>
  </div>

  <div class="sec">
    <h2>Requester Information</h2>
    <div class="grid">
      <div class="field"><div class="lbl">Full Name</div><div class="val">${req.requesterName}</div></div>
      <div class="field"><div class="lbl">Email Address</div><div class="val">${req.requesterEmail}</div></div>
    </div>
  </div>

  <div class="sec">
    <h2>Trip Details</h2>
    <div class="grid">
      <div class="field"><div class="lbl">Route / Destination</div><div class="val">${routeLabel}</div></div>
      <div class="field"><div class="lbl">Number of Passengers</div><div class="val">${req.numberOfPassengers}</div></div>
      <div class="field"><div class="lbl">Preferred Date</div><div class="val">${prefDate}</div></div>
      <div class="field"><div class="lbl">Preferred Departure Time</div><div class="val">${req.preferredDepartureTime}</div></div>
    </div>
  </div>

  <div class="sec">
    <h2>Purpose of Trip</h2>
    <div class="box">${req.purpose}</div>
  </div>

  ${req.notes ? `<div class="sec"><h2>Additional Notes</h2><div class="box">${req.notes}</div></div>` : ''}

  <div class="sec">
    <h2>Request Status</h2>
    <div class="field">
      <div class="val" style="border:none;padding:6px 0">
        <span class="badge">${req.status}</span>
        ${req.reviewedAt ? `&nbsp; &nbsp;<span style="font-size:12px;color:#555">Reviewed on ${new Date(req.reviewedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</span>` : ''}
        ${req.rejectionReason ? `<div style="margin-top:6px;color:#991b1b;font-size:12px">Reason: ${req.rejectionReason}</div>` : ''}
      </div>
    </div>
  </div>

  <div class="sig-row">
    <div class="sig-box">
      <div class="ttl">Signature of Requester</div>
      <div class="sig-line"></div>
      <div class="sig-label">Name &amp; Date</div>
    </div>
    <div class="sig-box">
      <div class="ttl">Administrative Approval</div>
      <div class="sig-line"></div>
      <div class="sig-label">Authorised Signatory &amp; Date</div>
      <div class="stamp">Official Stamp</div>
    </div>
  </div>

  <button class="print-btn" onclick="window.print()">🖨&nbsp;&nbsp;Print / Save as PDF</button>
</body>
</html>`;
}

module.exports = {
  submitRequest,
  listRequests,
  getMyRequests,
  approveRequest,
  rejectRequest,
  exportRequestHtml,
};
