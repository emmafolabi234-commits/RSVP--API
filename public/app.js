const STORAGE_KEY = 'gather-session';
const state = {
  account: readAccount(),
  events: [],
  organizerEvents: [],
  reservations: [],
  view: 'discover',
  timing: 'true',
  startDate: '',
  endDate: '',
  search: '',
  editingEventId: null,
};

const byId = (id) => document.getElementById(id);
let toastTimer;

function readAccount() {
  try {
    const account = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (account && account.token && account.id && ['attendee', 'organizer'].includes(account.role)) {
      return account;
    }
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.account?.token) headers.Authorization = `Bearer ${state.account.token}`;

  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The server returned an unreadable response. Please try again.');
  }

  if (!response.ok || result.success === false) {
    const message = response.status >= 500
      ? 'The service is temporarily unavailable. Please try again.'
      : result.error || `The request failed (${response.status}).`;
    if (response.status === 401 && state.account) {
      clearAccount();
      renderAccount();
    }
    throw new Error(message);
  }
  return result;
}

function showToast(message, type = 'success') {
  const toast = byId('toast');
  toast.textContent = message;
  toast.classList.toggle('error', type === 'error');
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
}

function formatDate(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date to be announced';
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    ...options,
  }).format(date);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function localDateTimeValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function renderAccount() {
  const accountButton = byId('account-button');
  const label = byId('account-label');
  const bookingsNav = byId('bookings-nav');
  const manageNav = byId('manage-nav');
  bookingsNav.hidden = state.account?.role !== 'attendee';
  manageNav.hidden = state.account?.role !== 'organizer';
  label.textContent = state.account
    ? `${state.account.role === 'organizer' ? 'Host' : 'Hi'}, ${state.account.name || state.account.email}`
    : '';
  accountButton.textContent = state.account ? 'Sign out' : 'Sign in';
  renderNavigation();
}

function renderNavigation() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.view);
  });
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('active', view.id === `${state.view}-view`);
  });
}

function setView(view) {
  if (view === 'bookings' && state.account?.role !== 'attendee') {
    openAuth('attendee');
    return;
  }
  if (view === 'manage' && state.account?.role !== 'organizer') {
    openAuth('organizer');
    return;
  }
  state.view = view;
  renderNavigation();
  if (view === 'bookings') loadReservations();
  if (view === 'manage') loadOrganizerEvents();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function eventDateChip(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '<span class="event-date-chip"><strong>--</strong><span>DATE</span></span>';
  return `<span class="event-date-chip"><strong>${date.getDate()}</strong><span>${escapeHtml(new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date))}</span></span>`;
}

function renderEvents() {
  const query = state.search.trim().toLowerCase();
  const events = state.events.filter((event) => {
    const text = `${event.title || ''} ${event.description || ''} ${event.venueOrLink || ''}`.toLowerCase();
    return !query || text.includes(query);
  });
  byId('results-label').textContent = `${events.length} ${events.length === 1 ? 'gathering' : 'gatherings'} to explore`;
  const reservationsByEvent = new Map(state.reservations.map((reservation) => [reservation.eventId, reservation]));

  if (!events.length) {
    byId('event-grid').innerHTML = '<div class="empty-state"><strong>No gatherings found just yet.</strong>Try changing your filters or check back soon.</div>';
    return;
  }

  byId('event-grid').innerHTML = events.map((event) => {
    const reserved = reservationsByEvent.get(event.id);
    const remaining = Math.max(0, Number(event.maxCapacity) - Number(event.currentCapacity || 0));
    const status = reserved
      ? 'You\'re in'
      : state.account?.role === 'organizer'
        ? 'Explore'
        : remaining === 0 ? 'Join waitlist' : 'Save my seat';
    const disabled = Boolean(reserved) || state.account?.role === 'organizer';
    const marker = escapeHtml((event.title || 'g').trim().slice(0, 1).toUpperCase());
    const dateTime = `${formatDate(event.dateTime)}${formatTime(event.dateTime) ? ` · ${formatTime(event.dateTime)}` : ''}`;
    return `
      <article class="event-card">
        <div class="event-art">${eventDateChip(event.dateTime)}<span class="event-art-mark">${marker}</span></div>
        <div class="event-card-body">
          <span class="event-category">${remaining ? `${remaining} ${remaining === 1 ? 'seat' : 'seats'} left` : 'OPEN WAITLIST'}</span>
          <h3>${escapeHtml(event.title || 'Untitled event')}</h3>
          <p class="event-description">${escapeHtml(event.description || 'A good reason to get together.')}</p>
          <div class="event-details">
            <span>◷ &nbsp;${escapeHtml(dateTime)}</span>
            <span>⌖ &nbsp;${escapeHtml(event.venueOrLink || 'Location to be announced')}</span>
          </div>
          <div class="event-bottom">
            <span class="capacity-note"><strong>${Number(event.currentCapacity || 0)}</strong> / ${Number(event.maxCapacity || 0)} going</span>
            <button class="card-action" type="button" data-action="reserve" data-event-id="${escapeHtml(event.id)}" ${disabled ? 'disabled' : ''}>${status}</button>
          </div>
        </div>
      </article>`;
  }).join('');
}

function eventFiltersUrl() {
  const params = new URLSearchParams();
  if (state.timing !== 'all') params.set('upcoming', state.timing);
  if (state.startDate) params.set('startDate', new Date(`${state.startDate}T00:00:00`).toISOString());
  if (state.endDate) params.set('endDate', new Date(`${state.endDate}T23:59:59.999`).toISOString());
  const query = params.toString();
  return `/api/events${query ? `?${query}` : ''}`;
}

async function loadEvents() {
  try {
    const result = await api(eventFiltersUrl());
    state.events = result.data || [];
    renderEvents();
  } catch (error) {
    byId('results-label').textContent = 'Events are unavailable right now.';
    byId('event-grid').innerHTML = `<div class="empty-state"><strong>We couldn't load gatherings.</strong>${escapeHtml(error.message)}</div>`;
  }
}

async function loadReservations() {
  if (state.account?.role !== 'attendee') return;
  try {
    const result = await api(`/api/attendees/${encodeURIComponent(state.account.id)}/events`);
    state.reservations = result.data || [];
    renderReservations();
    renderEvents();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderReservations() {
  const container = byId('reservation-list');
  if (!state.reservations.length) {
    container.innerHTML = '<div class="empty-state"><strong>Your next plan is out there.</strong>Browse upcoming events and save your seat.</div>';
    return;
  }
  const reservations = [...state.reservations].sort((a, b) => new Date(a.event?.dateTime || 0) - new Date(b.event?.dateTime || 0));
  container.innerHTML = reservations.map((reservation) => `
    <article class="reservation-card">
      <div>
        <h3>${escapeHtml(reservation.event?.title || 'Event')}</h3>
        <p>${escapeHtml(formatDate(reservation.event?.dateTime))}${formatTime(reservation.event?.dateTime) ? ` · ${escapeHtml(formatTime(reservation.event.dateTime))}` : ''} &nbsp;·&nbsp; ${escapeHtml(reservation.event?.venueOrLink || '')}</p>
      </div>
      <span class="status-pill ${reservation.status === 'WAITLISTED' ? 'waitlisted' : ''}">${reservation.status === 'WAITLISTED' ? 'Waitlisted' : 'Confirmed'}</span>
      <button class="button" type="button" data-action="cancel-rsvp" data-reservation-id="${escapeHtml(reservation.id)}">Cancel RSVP</button>
    </article>`).join('');
}

async function loadOrganizerEvents() {
  if (state.account?.role !== 'organizer') return;
  try {
    const result = await api('/api/events');
    state.organizerEvents = (result.data || []).filter((event) => event.organizerId === state.account.id);
    renderOrganizerEvents();
  } catch (error) {
    byId('organizer-event-list').innerHTML = `<div class="empty-state"><strong>Couldn't load your events.</strong>${escapeHtml(error.message)}</div>`;
  }
}

function renderOrganizerEvents() {
  const events = [...state.organizerEvents].sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
  byId('organizer-event-count').textContent = String(events.length);
  const container = byId('organizer-event-list');
  if (!events.length) {
    container.innerHTML = '<div class="empty-state"><strong>Your first event starts here.</strong>Create a gathering and invite your people.</div>';
    return;
  }
  container.innerHTML = events.map((event) => `
    <article class="managed-event" data-managed-event="${escapeHtml(event.id)}">
      <div class="managed-event-main">
        <div>
          <h3>${escapeHtml(event.title)}</h3>
          <p>${escapeHtml(formatDate(event.dateTime))} · ${escapeHtml(formatTime(event.dateTime))}<br>${escapeHtml(event.venueOrLink)}<br>${Number(event.currentCapacity || 0)} / ${Number(event.maxCapacity)} confirmed</p>
        </div>
      </div>
      <div class="managed-event-actions">
        <button type="button" data-action="edit-event" data-event-id="${escapeHtml(event.id)}">Edit</button>
        <button type="button" data-action="attendees" data-event-id="${escapeHtml(event.id)}">Guest list</button>
        <button class="danger-action" type="button" data-action="delete-event" data-event-id="${escapeHtml(event.id)}">Delete</button>
      </div>
      <div class="guest-list" data-guest-list="${escapeHtml(event.id)}" hidden></div>
    </article>`).join('');
}

function openAuth(role = 'attendee') {
  setAuthRole(role);
  byId('auth-error').textContent = '';
  byId('auth-dialog').showModal();
}

function setAuthRole(role) {
  byId('auth-form').dataset.role = role;
  document.querySelectorAll('[data-role]').forEach((button) => {
    button.classList.toggle('active', button.dataset.role === role);
  });
  const isAttendee = role === 'attendee';
  byId('name-field').hidden = !isAttendee || byId('auth-form').dataset.mode !== 'register';
  byId('phone-field').hidden = !isAttendee || byId('auth-form').dataset.mode !== 'register';
  byId('auth-form').elements.name.required = isAttendee && byId('auth-form').dataset.mode === 'register';
  byId('auth-form').elements.name.autocomplete = byId('auth-form').dataset.mode === 'register' ? 'name' : 'off';
}

function setAuthMode(mode) {
  const form = byId('auth-form');
  form.dataset.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  const password = form.elements.password;
  password.minLength = mode === 'register' ? 12 : 1;
  password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  byId('auth-submit').innerHTML = mode === 'register' ? 'Create account <span aria-hidden="true">↗</span>' : 'Sign in <span aria-hidden="true">↗</span>';
  byId('password-note').textContent = mode === 'register'
    ? 'Choose a password between 12 and 128 characters.'
    : 'Use the password you chose when you signed up.';
  setAuthRole(form.dataset.role || 'attendee');
}

function clearAccount() {
  state.account = null;
  state.reservations = [];
  state.organizerEvents = [];
  sessionStorage.removeItem(STORAGE_KEY);
  if (state.view !== 'discover') state.view = 'discover';
  renderAccount();
  renderReservations();
  renderEvents();
}

function eventPayload(form) {
  const data = new FormData(form);
  return {
    title: data.get('title').trim(),
    description: data.get('description').trim(),
    venueOrLink: data.get('venueOrLink').trim(),
    dateTime: new Date(data.get('dateTime')).toISOString(),
    maxCapacity: Number(data.get('maxCapacity')),
  };
}

function beginEdit(eventId) {
  const event = state.organizerEvents.find((item) => item.id === eventId);
  if (!event) return;
  const form = byId('event-form');
  form.elements.title.value = event.title || '';
  form.elements.description.value = event.description || '';
  form.elements.venueOrLink.value = event.venueOrLink || '';
  form.elements.dateTime.value = localDateTimeValue(event.dateTime);
  form.elements.maxCapacity.value = event.maxCapacity;
  state.editingEventId = eventId;
  byId('event-form-title').textContent = 'Edit your event';
  byId('event-form-kicker').textContent = 'MAKE A CHANGE';
  byId('event-submit').innerHTML = 'Save changes <span aria-hidden="true">↗</span>';
  byId('cancel-edit').hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetEventForm() {
  state.editingEventId = null;
  byId('event-form').reset();
  byId('event-form-title').textContent = 'Create an event';
  byId('event-form-kicker').textContent = 'START SOMETHING GOOD';
  byId('event-submit').innerHTML = 'Create event <span aria-hidden="true">↗</span>';
  byId('cancel-edit').hidden = true;
}

async function showAttendees(eventId, button) {
  const list = document.querySelector(`[data-guest-list="${CSS.escape(eventId)}"]`);
  if (!list) return;
  if (!list.hidden) {
    list.hidden = true;
    button.textContent = 'Guest list';
    return;
  }
  button.disabled = true;
  try {
    const result = await api(`/api/events/${encodeURIComponent(eventId)}/attendees`);
    const guests = result.data || [];
    list.innerHTML = guests.length
      ? guests.map((reservation) => `
        <div class="guest-row">
          <span>${escapeHtml(reservation.attendee?.name || 'Attendee')} · ${escapeHtml(reservation.attendee?.email || '')}</span>
          <span class="guest-status ${reservation.status === 'WAITLISTED' ? 'waitlisted' : ''}">${escapeHtml(reservation.status || 'CONFIRMED')}</span>
        </div>`).join('')
      : '<p>No RSVPs yet. Your first guest will show up here.</p>';
    list.hidden = false;
    button.textContent = 'Hide guest list';
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

document.addEventListener('click', async (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    setView(viewButton.dataset.view);
    return;
  }
  const roleButton = event.target.closest('[data-role]');
  if (roleButton) {
    setAuthRole(roleButton.dataset.role);
    return;
  }
  const modeButton = event.target.closest('[data-mode]');
  if (modeButton) {
    setAuthMode(modeButton.dataset.mode);
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const action = actionButton.dataset.action;
  try {
    if (action === 'reserve') {
      if (state.account?.role !== 'attendee') {
        openAuth('attendee');
        return;
      }
      actionButton.disabled = true;
      const result = await api('/api/rsvps', {
        method: 'POST',
        body: { eventId: actionButton.dataset.eventId },
      });
      showToast(result.data?.status === 'WAITLISTED' ? 'You are on the waitlist. We will keep your place in line.' : 'You are on the list. See you there!');
      await Promise.all([loadEvents(), loadReservations()]);
    } else if (action === 'cancel-rsvp') {
      if (!window.confirm('Cancel this RSVP?')) return;
      actionButton.disabled = true;
      await api(`/api/rsvps/${encodeURIComponent(actionButton.dataset.reservationId)}`, { method: 'DELETE' });
      showToast('Your RSVP has been cancelled.');
      await Promise.all([loadReservations(), loadEvents()]);
    } else if (action === 'edit-event') {
      beginEdit(actionButton.dataset.eventId);
    } else if (action === 'delete-event') {
      if (!window.confirm('Delete this event and its RSVPs? This cannot be undone.')) return;
      actionButton.disabled = true;
      await api(`/api/events/${encodeURIComponent(actionButton.dataset.eventId)}`, { method: 'DELETE' });
      showToast('Event deleted.');
      await Promise.all([loadOrganizerEvents(), loadEvents()]);
    } else if (action === 'attendees') {
      await showAttendees(actionButton.dataset.eventId, actionButton);
    }
  } catch (error) {
    actionButton.disabled = false;
    showToast(error.message, 'error');
  }
});

byId('account-button').addEventListener('click', () => {
  if (state.account) {
    clearAccount();
    showToast('You have signed out.');
  } else {
    openAuth('attendee');
  }
});

byId('organizer-cta').addEventListener('click', () => {
  if (state.account?.role === 'organizer') setView('manage');
  else openAuth('organizer');
});

byId('filters-form').addEventListener('submit', (event) => {
  event.preventDefault();
  state.timing = byId('timing-filter').value;
  state.startDate = byId('start-date').value;
  state.endDate = byId('end-date').value;
  if (state.startDate && state.endDate && state.startDate > state.endDate) {
    showToast('The start date must be on or before the end date.', 'error');
    return;
  }
  loadEvents();
});

byId('search-input').addEventListener('input', (event) => {
  state.search = event.target.value;
  renderEvents();
});

byId('clear-filters').addEventListener('click', () => {
  byId('filters-form').reset();
  byId('search-input').value = '';
  state.search = '';
  state.timing = 'true';
  state.startDate = '';
  state.endDate = '';
  loadEvents();
});

byId('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = byId('auth-submit');
  const role = form.dataset.role || 'attendee';
  const mode = form.dataset.mode || 'login';
  const data = new FormData(form);
  const body = {
    email: data.get('email').trim(),
    password: data.get('password'),
  };
  if (role === 'attendee' && mode === 'register') {
    body.name = data.get('name').trim();
    if (data.get('phoneNumber').trim()) body.phoneNumber = data.get('phoneNumber').trim();
  }
  const endpointRole = role === 'attendee' ? 'attendees' : 'organizers';
  submit.disabled = true;
  byId('auth-error').textContent = '';
  try {
    const result = await api(`/api/${endpointRole}/${mode === 'register' ? 'register' : 'login'}`, {
      method: 'POST',
      body,
    });
    const identity = result.data[role];
    state.account = {
      role,
      id: identity.id,
      name: identity.name || identity.email,
      email: identity.email,
      token: result.data.token,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.account));
    renderAccount();
    byId('auth-dialog').close();
    form.reset();
    showToast(mode === 'register' ? 'Your account is ready. Welcome!' : 'Welcome back.');
    if (role === 'attendee') {
      await Promise.all([loadReservations(), loadEvents()]);
      if (state.view === 'bookings') renderReservations();
    } else {
      await loadOrganizerEvents();
      setView('manage');
    }
  } catch (error) {
    byId('auth-error').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

byId('event-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = byId('event-submit');
  submit.disabled = true;
  try {
    const payload = eventPayload(event.currentTarget);
    const editingId = state.editingEventId;
    await api(editingId ? `/api/events/${encodeURIComponent(editingId)}` : '/api/events', {
      method: editingId ? 'PUT' : 'POST',
      body: payload,
    });
    resetEventForm();
    showToast(editingId ? 'Your event has been updated.' : 'Your event is live. Let the good plans begin.');
    await Promise.all([loadOrganizerEvents(), loadEvents()]);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submit.disabled = false;
  }
});

byId('cancel-edit').addEventListener('click', resetEventForm);

byId('auth-dialog').addEventListener('close', () => {
  byId('auth-error').textContent = '';
});

setAuthMode('login');
renderAccount();
renderReservations();
loadEvents();
if (state.account?.role === 'attendee') loadReservations();
