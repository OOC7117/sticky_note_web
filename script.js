(() => {
  const STORAGE_KEY = 'sticky-notes-app';
  const NOTE_COLORS = [
    { id: 'sunny', label: 'Warm yellow' },
    { id: 'blush', label: 'Soft blush' },
    { id: 'mint', label: 'Fresh mint' },
    { id: 'sky', label: 'Calm sky' },
    { id: 'mist', label: 'Cool mist' },
  ];
  const NOTE_COLOR_IDS = new Set(NOTE_COLORS.map((color) => color.id));
  const LEGACY_COLOR_MAP = {
    lavender: 'mist',
    purple: 'mist',
  };
  const DEFAULT_NOTE_COLOR = NOTE_COLORS[0].id;

  const noteForm = document.querySelector('#note-form');
  const titleInput = document.querySelector('#note-title');
  const contentInput = document.querySelector('#note-content');
  const todosInput = document.querySelector('#note-todos');
  const submitButton = document.querySelector('.note-form__submit');
  const cancelButton = document.querySelector('.note-form__cancel');
  const searchInput = document.querySelector('#search-input');
  const notesList = document.querySelector('#notes-list');
  const emptyState = document.querySelector('#empty-state');
  const noteTemplate = document.querySelector('#note-template');
  const undoStackContainer = document.querySelector('#undo-stack');
  const undoSnackbarTemplate = document.querySelector('#undo-snackbar-template');

  let notes = loadNotes();
  let editingNoteId = null;
  let draggedNoteId = null;
  const undoNotifications = [];
  const completedSectionOpenState = new Map();
  let pendingInlineFocus = null;

  if (undoStackContainer) {
    undoStackContainer.setAttribute('aria-hidden', 'true');
  }
  let targetedNoteId = null;

  renderNotes();

  function findNoteById(id) {
    if (!id) {
      return undefined;
    }

    return notes.find((note) => note.id === id);
  }

  noteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    const todoRawValue = todosInput ? todosInput.value : '';

    if (!title || !content) {
      return;
    }

    const existingTodos = editingNoteId
      ? findNoteById(editingNoteId)?.todos || []
      : [];
    const todos = parseTodoInput(todoRawValue, existingTodos);

    if (editingNoteId) {
      updateNote(editingNoteId, { title, content, todos });
    } else {
      createNote({ title, content, todos });
    }

    clearAllUndoNotifications();
    resetForm();
    renderNotes();
  });

  cancelButton.addEventListener('click', () => {
    resetForm();
    clearHighlights();
  });

  searchInput.addEventListener('input', () => {
    renderNotes();
  });

  notesList.addEventListener('click', (event) => {
    const noteElement = event.target.closest('[data-note-id]');
    if (noteElement) {
      setTargetedNote(noteElement.dataset.noteId);
    }

    const colorButton = event.target.closest('button.note__color');
    if (colorButton) {
      if (!noteElement) {
        return;
      }

      const noteId = noteElement.dataset.noteId;
      const selectedColor = colorButton.dataset.color;
      if (!selectedColor) {
        return;
      }

      updateNote(noteId, { color: selectedColor });
      renderNotes();
      return;
    }

    const priorityButton = event.target.closest('button.note__todo-priority');
    if (priorityButton) {
      if (!noteElement) {
        return;
      }

      const noteId = noteElement.dataset.noteId;
      const todoItem = priorityButton.closest('[data-todo-id]');
      if (!noteId || !todoItem || !todoItem.dataset.todoId) {
        return;
      }

      event.preventDefault();
      toggleTodoPriority(noteId, todoItem.dataset.todoId);
      renderNotes();
      return;
    }

    const removeButton = event.target.closest('button.note__todo-remove');
    if (removeButton) {
      if (!noteElement) {
        return;
      }

      const noteId = noteElement.dataset.noteId;
      const todoItem = removeButton.closest('[data-todo-id]');
      if (!noteId || !todoItem || !todoItem.dataset.todoId) {
        return;
      }

      event.preventDefault();
      pendingInlineFocus = noteId;
      removeTodo(noteId, todoItem.dataset.todoId);
      renderNotes();
      return;
    }

    const actionButton = event.target.closest('button.note__action');
    if (!actionButton) {
      return;
    }

    if (!noteElement) {
      return;
    }

    const noteId = noteElement.dataset.noteId;

    if (actionButton.classList.contains('note__action--edit')) {
      beginEdit(noteId);
    } else if (actionButton.classList.contains('note__action--delete')) {
      handleDelete(noteId);
    }
  });

  notesList.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (!target.classList.contains('note__todo-checkbox')) {
      return;
    }

    const noteElement = target.closest('[data-note-id]');
    const todoItem = target.closest('[data-todo-id]');
    if (!noteElement || !todoItem) {
      return;
    }

    const noteId = noteElement.dataset.noteId;
    const todoId = todoItem.dataset.todoId;
    if (!noteId || !todoId) {
      return;
    }

    toggleTodoCompletion(noteId, todoId, target.checked);
    renderNotes();
  });

  notesList.addEventListener('toggle', (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement)) {
      return;
    }

    if (!details.classList.contains('note__todo-completed')) {
      return;
    }

    const noteElement = details.closest('[data-note-id]');
    if (!noteElement) {
      return;
    }

    const noteId = noteElement.dataset.noteId;
    if (!noteId) {
      return;
    }

    if (details.open) {
      completedSectionOpenState.set(noteId, true);
    } else {
      completedSectionOpenState.delete(noteId);
    }
  });

  notesList.addEventListener('focusin', (event) => {
    const noteElement = event.target.closest('.note');
    if (!noteElement) {
      return;
    }

    noteElement.classList.add('note--focused');
  });

  notesList.addEventListener('focusout', (event) => {
    const noteElement = event.target.closest('.note');
    if (!noteElement) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!noteElement.contains(document.activeElement)) {
        noteElement.classList.remove('note--focused');
      }
    });
  });

  notesList.addEventListener('keydown', (event) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.classList.contains('note') &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault();
      const noteId = event.target.dataset.noteId;
      if (noteId) {
        setTargetedNote(noteId);
      }
    }
  });

  document.addEventListener('click', (event) => {
    if (!targetedNoteId) {
      return;
    }

    if (event.target instanceof Element && event.target.closest('.note')) {
      return;
    }

    setTargetedNote(null);
  });

  document.addEventListener('focusin', (event) => {
    if (!targetedNoteId) {
      return;
    }

    if (event.target instanceof Element && event.target.closest('.note')) {
      return;
    }

    setTargetedNote(null);
  });

  notesList.addEventListener('dragstart', (event) => {
    const noteElement = event.target.closest('.note');
    if (!noteElement) {
      return;
    }

    draggedNoteId = noteElement.dataset.noteId;
    noteElement.classList.add('note--dragging');

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedNoteId);
    }
  });

  notesList.addEventListener('dragend', () => {
    clearDragIndicators();
    draggedNoteId = null;
  });

  notesList.addEventListener('dragover', (event) => {
    if (!draggedNoteId) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    updateDropIndicator(event.clientY);
  });

  notesList.addEventListener('drop', (event) => {
    if (!draggedNoteId) {
      return;
    }

    event.preventDefault();

    const { element: dropTarget, insertBefore } = determineDropPosition(event.clientY);
    const targetId = dropTarget ? dropTarget.dataset.noteId : null;

    reorderNotes(draggedNoteId, targetId, insertBefore);
    clearDragIndicators();
    draggedNoteId = null;
    renderNotes();
  });

  notesList.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    if (!form.classList.contains('note__todo-inline-form')) {
      return;
    }

    event.preventDefault();

    const noteElement = form.closest('[data-note-id]');
    if (!noteElement) {
      return;
    }

    const noteId = noteElement.dataset.noteId;
    if (!noteId) {
      return;
    }

    const input = form.querySelector('.note__todo-inline-input');
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const added = addTodoInline(noteId, input.value);
    if (!added) {
      input.value = '';
      input.focus();
      return;
    }

    pendingInlineFocus = noteId;
    input.value = '';
    renderNotes();
  });

  function createNote({ title, content, color, todos }) {
    const newNote = {
      id: crypto.randomUUID(),
      title,
      content,
      color: normalizeNoteColor(color),
      todos: sanitizeTodos(todos),
      updatedAt: new Date().toISOString(),
    };

    notes = [newNote, ...notes];
    persistNotes();
  }

  function updateNote(id, changes) {
    const nextChanges = { ...changes };
    if (Object.prototype.hasOwnProperty.call(nextChanges, 'color')) {
      nextChanges.color = normalizeNoteColor(nextChanges.color);
    }
    if (Object.prototype.hasOwnProperty.call(nextChanges, 'todos')) {
      nextChanges.todos = sanitizeTodos(nextChanges.todos);
    }

    notes = notes.map((note) =>
      note.id === id
        ? { ...note, ...nextChanges, updatedAt: new Date().toISOString() }
        : note
    );
    persistNotes();
  }

  function handleDelete(id) {
    const deleted = deleteNote(id);
    if (!deleted) {
      return;
    }

    if (targetedNoteId === id) {
      targetedNoteId = null;
    }

    if (editingNoteId === id) {
      resetForm();
    }

    completedSectionOpenState.delete(id);
    renderNotes();
    showUndoNotification(deleted);
  }

  function deleteNote(id) {
    const index = notes.findIndex((note) => note.id === id);
    if (index === -1) {
      return null;
    }

    const updatedNotes = [...notes];
    const [removedNote] = updatedNotes.splice(index, 1);
    notes = updatedNotes;
    persistNotes();
    return { note: removedNote, index };
  }

  function beginEdit(id) {
    const note = notes.find((item) => item.id === id);
    if (!note) {
      return;
    }

    clearAllUndoNotifications();
    editingNoteId = note.id;
    titleInput.value = note.title;
    contentInput.value = note.content;
    if (todosInput) {
      todosInput.value = formatTodosForInput(note.todos);
    }
    submitButton.textContent = 'Update note';
    cancelButton.hidden = false;
    highlightNote(id);
    titleInput.focus();
  }

  function resetForm() {
    noteForm.reset();
    if (todosInput) {
      todosInput.value = '';
    }
    editingNoteId = null;
    submitButton.textContent = 'Add note';
    cancelButton.hidden = true;
  }

  function loadNotes() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        return [];
      }

      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((note) => note && typeof note.id === 'string')
        .map((note) => ({
          ...note,
          color: normalizeNoteColor(note.color),
          todos: sanitizeTodos(note.todos),
        }));
    } catch (error) {
      console.error('Failed to load notes from storage', error);
      return [];
    }
  }

  function persistNotes() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }

  function showUndoNotification(deleted) {
    if (!undoStackContainer || !undoSnackbarTemplate) {
      return;
    }

    const node = undoSnackbarTemplate.content.firstElementChild.cloneNode(true);
    const message = node.querySelector('.undo-snackbar__message');
    const undoButton = node.querySelector('.undo-snackbar__action--undo');
    const closeButton = node.querySelector('.undo-snackbar__close');

    if (message) {
      message.textContent = `Deleted "${deleted.note.title}"`;
    }

    const notification = {
      id: crypto.randomUUID(),
      deleted,
      element: node,
    };

    if (undoButton) {
      undoButton.addEventListener('click', () => {
        handleUndoAction(notification.id);
      });
    }

    if (closeButton) {
      closeButton.addEventListener('click', () => {
        dismissUndoNotification(notification.id);
      });
    }

    undoNotifications.push(notification);
    undoStackContainer.appendChild(node);
    updateUndoStackPositions();

    if (undoButton) {
      window.requestAnimationFrame(() => {
        undoButton.focus();
      });
    }
  }

  function handleUndoAction(notificationId) {
    const index = undoNotifications.findIndex((item) => item.id === notificationId);
    if (index === -1) {
      return;
    }

    const { note, index: originalIndex } = undoNotifications[index].deleted;
    const insertIndex = Math.min(originalIndex, notes.length);
    notes = [...notes];
    notes.splice(insertIndex, 0, note);
    persistNotes();
    renderNotes();
    dismissUndoNotification(notificationId);
  }

  function dismissUndoNotification(notificationId) {
    const index = undoNotifications.findIndex((item) => item.id === notificationId);
    if (index === -1) {
      return;
    }

    const [notification] = undoNotifications.splice(index, 1);
    const shouldRefocus = notification.element
      ? notification.element.contains(document.activeElement)
      : false;
    if (notification.element && notification.element.parentElement) {
      notification.element.parentElement.removeChild(notification.element);
    }

    updateUndoStackPositions();

    if (shouldRefocus) {
      focusFrontUndoButton();
    }
  }

  function clearAllUndoNotifications() {
    if (!undoStackContainer || undoNotifications.length === 0) {
      return;
    }

    undoNotifications.forEach((notification) => {
      if (notification.element && notification.element.parentElement) {
        notification.element.parentElement.removeChild(notification.element);
      }
    });

    undoNotifications.length = 0;
    updateUndoStackPositions();
  }

  function updateUndoStackPositions() {
    if (!undoStackContainer) {
      return;
    }

    undoNotifications.forEach((notification, index) => {
      if (!notification.element) {
        return;
      }

      const stackIndex = undoNotifications.length - 1 - index;
      const visualIndex = Math.min(stackIndex, 4);
      notification.element.style.setProperty('--stack-index', `${stackIndex}`);
      notification.element.style.setProperty('--stack-visual-index', `${visualIndex}`);
    });

    if (undoNotifications.length === 0) {
      undoStackContainer.setAttribute('aria-hidden', 'true');
    } else {
      undoStackContainer.setAttribute('aria-hidden', 'false');
    }
  }

  function focusFrontUndoButton() {
    const frontNotification = undoNotifications[undoNotifications.length - 1];
    if (!frontNotification || !frontNotification.element) {
      return;
    }

    const undoButton = frontNotification.element.querySelector('.undo-snackbar__action--undo');
    if (undoButton) {
      undoButton.focus();
    }
  }

  function renderNotes() {
    clearHighlights();
    const query = searchInput.value.trim().toLowerCase();

    const filteredNotes = query
      ? notes.filter((note) => {
          const matchesTitleOrContent =
            note.title.toLowerCase().includes(query) ||
            note.content.toLowerCase().includes(query);
          const matchesTodos = Array.isArray(note.todos)
            ? note.todos.some((todo) => todo.text.toLowerCase().includes(query))
            : false;
          return matchesTitleOrContent || matchesTodos;
        })
      : notes;

    notesList.innerHTML = '';

    if (filteredNotes.length === 0) {
      emptyState.hidden = false;
      applyTargetedState();
      pendingInlineFocus = null;
      return;
    }

    emptyState.hidden = true;

    filteredNotes.forEach((note) => {
      const node = noteTemplate.content.firstElementChild.cloneNode(true);
      const titleEl = node.querySelector('.note__title');
      const contentEl = node.querySelector('.note__content');
      const timestampEl = node.querySelector('.note__timestamp');
      const paletteEl = node.querySelector('.note__palette');
      const todosSection = node.querySelector('.note__todos');

      node.dataset.noteId = note.id;
      node.setAttribute('draggable', 'true');
      node.dataset.color = normalizeNoteColor(note.color);
      titleEl.textContent = note.title;
      contentEl.textContent = note.content;

      const updatedDate = new Date(note.updatedAt);
      timestampEl.dateTime = updatedDate.toISOString();
      timestampEl.textContent = `Updated ${formatRelativeDate(updatedDate)}`;

      renderPalette(paletteEl, note);
      renderTodos(todosSection, note);

      notesList.appendChild(node);
    });

    applyTargetedState();

    if (editingNoteId) {
      const editingElement = notesList.querySelector(
        `[data-note-id="${editingNoteId}"]`
      );
      if (editingElement) {
        editingElement.classList.add('note--highlight');
      }
    }

    if (pendingInlineFocus) {
      const focusTarget = notesList.querySelector(
        `[data-note-id="${pendingInlineFocus}"] .note__todo-inline-input`
      );
      pendingInlineFocus = null;
      if (focusTarget instanceof HTMLInputElement) {
        focusTarget.focus();
      }
    }
  }

  function renderTodos(section, note) {
    if (!section) {
      return;
    }

    const pendingList = section.querySelector('.note__todo-list--pending');
    const completedList = section.querySelector('.note__todo-list--done');
    const emptyMessage = section.querySelector('.note__todo-empty');
    const completedDetails = section.querySelector('.note__todo-completed');
    const completedCount = section.querySelector('.note__todo-completed-count');
    const inlineInput = section.querySelector('.note__todo-inline-input');

    if (
      !pendingList ||
      !completedList ||
      !emptyMessage ||
      !completedDetails ||
      !completedCount
    ) {
      return;
    }

    pendingList.innerHTML = '';
    completedList.innerHTML = '';

    const todos = Array.isArray(note.todos) ? note.todos : [];

    if (todos.length === 0) {
      section.hidden = false;
      emptyMessage.hidden = false;
      emptyMessage.textContent = 'No to-dos yet. Add one above to get started.';
      completedDetails.hidden = true;
      completedDetails.open = false;
      completedCount.textContent = '0';
      completedSectionOpenState.delete(note.id);
      if (inlineInput instanceof HTMLInputElement) {
        inlineInput.value = '';
      }
      return;
    }

    section.hidden = false;

    const pending = todos.filter((todo) => !todo.completed);
    const completed = todos.filter((todo) => todo.completed);

    pending.forEach((todo) => {
      pendingList.appendChild(createTodoListItem(todo));
    });

    if (pending.length === 0) {
      emptyMessage.hidden = false;
      emptyMessage.textContent = 'All to-dos are done. Nicely handled!';
    } else {
      emptyMessage.hidden = true;
    }

    if (completed.length === 0) {
      completedDetails.hidden = true;
      completedDetails.open = false;
      completedCount.textContent = '0';
      completedSectionOpenState.delete(note.id);
    } else {
      completedDetails.hidden = false;
      completedCount.textContent = String(completed.length);
      completed.forEach((todo) => {
        completedList.appendChild(createTodoListItem(todo));
      });

      if (completedSectionOpenState.has(note.id)) {
        completedDetails.open = true;
      } else {
        completedDetails.open = false;
      }
    }

    if (inlineInput instanceof HTMLInputElement) {
      inlineInput.value = '';
    }
  }

  function createTodoListItem(todo) {
    const item = document.createElement('li');
    item.className = 'note__todo-item';
    item.dataset.todoId = todo.id;

    if (todo.priority && !todo.completed) {
      item.classList.add('note__todo-item--priority');
    }

    if (todo.completed) {
      item.classList.add('note__todo-item--completed');
    }

    const label = document.createElement('label');
    label.className = 'note__todo-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'note__todo-checkbox';
    checkbox.checked = Boolean(todo.completed);

    const text = document.createElement('span');
    text.className = todo.completed
      ? 'note__todo-text note__todo-text--completed'
      : 'note__todo-text';
    text.textContent = todo.text;

    label.appendChild(checkbox);
    label.appendChild(text);
    item.appendChild(label);

    const actions = document.createElement('div');
    actions.className = 'note__todo-actions';

    if (!todo.completed) {
      const priorityButton = document.createElement('button');
      priorityButton.type = 'button';
      priorityButton.className = 'note__todo-priority';
      priorityButton.setAttribute('aria-pressed', String(Boolean(todo.priority)));
      priorityButton.title = todo.priority
        ? 'Remove priority'
        : 'Mark as priority';
      priorityButton.setAttribute(
        'aria-label',
        todo.priority
          ? `Remove priority from "${todo.text}"`
          : `Mark "${todo.text}" as priority`
      );

      const icon = document.createElement('span');
      icon.className = 'note__todo-priority-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '⚑';

      priorityButton.appendChild(icon);
      actions.appendChild(priorityButton);
    }

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'note__todo-remove';
    removeButton.title = `Delete "${todo.text}"`;
    removeButton.setAttribute('aria-label', `Delete "${todo.text}"`);
    removeButton.textContent = 'Delete';

    actions.appendChild(removeButton);
    item.appendChild(actions);

    return item;
  }

  function renderPalette(container, note) {
    if (!container) {
      return;
    }

    container.innerHTML = '';

    const activeColor = normalizeNoteColor(note.color);

    NOTE_COLORS.forEach((color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note__color';
      const isActive = color.id === activeColor;
      if (isActive) {
        button.classList.add('note__color--active');
      }
      button.dataset.color = color.id;
      button.setAttribute('aria-pressed', String(isActive));
      button.title = color.label;

      const label = document.createElement('span');
      label.className = 'visually-hidden';
      label.textContent = color.label;

      button.appendChild(label);
      container.appendChild(button);
    });
  }

  function highlightNote(id) {
    clearHighlights();
    const noteElement = notesList.querySelector(`[data-note-id="${id}"]`);
    if (noteElement) {
      noteElement.classList.add('note--highlight');
      noteElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function clearHighlights() {
    notesList
      .querySelectorAll('.note--highlight')
      .forEach((element) => element.classList.remove('note--highlight'));
  }

  function setTargetedNote(id) {
    if (!id) {
      targetedNoteId = null;
      applyTargetedState();
      return;
    }

    targetedNoteId = id;
    applyTargetedState();
  }

  function applyTargetedState() {
    notesList
      .querySelectorAll('.note--targeted')
      .forEach((element) => element.classList.remove('note--targeted'));

    if (!targetedNoteId) {
      return;
    }

    const targetedElement = notesList.querySelector(
      `[data-note-id="${targetedNoteId}"]`
    );

    if (targetedElement) {
      targetedElement.classList.add('note--targeted');
    } else {
      targetedNoteId = null;
    }
  }

  function toggleTodoCompletion(noteId, todoId, completed) {
    updateNoteTodos(noteId, (todos) =>
      todos.map((todo) =>
        todo.id === todoId
          ? {
              ...todo,
              completed,
              completedAt: completed ? new Date().toISOString() : null,
              priority: completed ? false : todo.priority,
            }
          : todo
      )
    );
  }

  function toggleTodoPriority(noteId, todoId) {
    updateNoteTodos(noteId, (todos) =>
      todos.map((todo) =>
        todo.id === todoId
          ? todo.completed
            ? { ...todo, priority: false }
            : { ...todo, priority: !todo.priority }
          : todo
      )
    );
  }

  function addTodoInline(noteId, text) {
    const normalized = normalizeTodoText(text);
    if (!normalized) {
      return false;
    }

    const note = findNoteById(noteId);
    if (!note) {
      return false;
    }

    const currentTodos = Array.isArray(note.todos) ? note.todos : [];
    const newTodo = createTodoFromText(normalized);
    updateNote(noteId, { todos: [...currentTodos, newTodo] });
    return true;
  }

  function updateNoteTodos(noteId, updater) {
    const note = findNoteById(noteId);
    if (!note) {
      return;
    }

    const currentTodos = Array.isArray(note.todos) ? note.todos : [];
    const nextTodos = updater(currentTodos);
    if (!Array.isArray(nextTodos)) {
      return;
    }

    updateNote(noteId, { todos: nextTodos });
  }

  function removeTodo(noteId, todoId) {
    updateNoteTodos(noteId, (todos) => todos.filter((todo) => todo.id !== todoId));
  }

  function parseTodoInput(rawValue, previousTodos = []) {
    if (typeof rawValue !== 'string') {
      return sanitizeTodos(previousTodos);
    }

    const lines = rawValue
      .split('\n')
      .map((line) => normalizeTodoText(line))
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return [];
    }

    const normalizedPrevious = sanitizeTodos(previousTodos);
    const buckets = new Map();
    normalizedPrevious.forEach((todo) => {
      const key = todo.text.toLowerCase();
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(todo);
      } else {
        buckets.set(key, [todo]);
      }
    });

    const now = Date.now();
    const updatedTodos = lines.map((line, index) => {
      const key = line.toLowerCase();
      const bucket = buckets.get(key);
      if (bucket && bucket.length > 0) {
        const existing = bucket.shift();
        return { ...existing, text: line };
      }

      return {
        id: crypto.randomUUID(),
        text: line,
        completed: false,
        priority: false,
        createdAt: new Date(now + index).toISOString(),
        completedAt: null,
      };
    });

    return sanitizeTodos(updatedTodos);
  }

  function formatTodosForInput(todos) {
    if (!Array.isArray(todos) || todos.length === 0) {
      return '';
    }

    return todos.map((todo) => todo.text).join('\n');
  }

  function sanitizeTodos(rawTodos) {
    if (!Array.isArray(rawTodos)) {
      return [];
    }

    const now = Date.now();

    const sanitized = rawTodos
      .map((todo, index) => {
        if (!todo || typeof todo !== 'object') {
          return null;
        }

        const text = normalizeTodoText(todo.text);
        if (!text) {
          return null;
        }

        const id =
          typeof todo.id === 'string' && todo.id.trim().length > 0
            ? todo.id
            : crypto.randomUUID();

        const createdAt =
          typeof todo.createdAt === 'string' && !Number.isNaN(Date.parse(todo.createdAt))
            ? todo.createdAt
            : new Date(now + index).toISOString();

        const completed = Boolean(todo.completed);
        const priority = completed ? false : Boolean(todo.priority);

        const completedAt = completed
          ? typeof todo.completedAt === 'string' && !Number.isNaN(Date.parse(todo.completedAt))
            ? todo.completedAt
            : new Date(now + index).toISOString()
          : null;

        return {
          id,
          text,
          completed,
          priority,
          createdAt,
          completedAt,
        };
      })
      .filter(Boolean);

    return sortTodos(sanitized);
  }

  function createTodoFromText(text) {
    return {
      id: crypto.randomUUID(),
      text,
      completed: false,
      priority: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
  }

  function normalizeTodoText(value) {
    if (typeof value !== 'string') {
      return '';
    }

    return value.trim().replace(/\s+/g, ' ');
  }

  function sortTodos(todos) {
    const pendingPriority = [];
    const pending = [];
    const completed = [];

    todos.forEach((todo) => {
      if (todo.completed) {
        completed.push(todo);
      } else if (todo.priority) {
        pendingPriority.push(todo);
      } else {
        pending.push(todo);
      }
    });

    const byCreatedAt = (a, b) => compareTimestamp(a.createdAt, b.createdAt);
    const byCompletedDesc = (a, b) => compareTimestamp(b.completedAt, a.completedAt);

    pendingPriority.sort(byCreatedAt);
    pending.sort(byCreatedAt);
    completed.sort(byCompletedDesc);

    return [...pendingPriority, ...pending, ...completed];
  }

  function compareTimestamp(a, b) {
    const timeA = typeof a === 'string' ? Date.parse(a) : NaN;
    const timeB = typeof b === 'string' ? Date.parse(b) : NaN;

    const invalidA = Number.isNaN(timeA);
    const invalidB = Number.isNaN(timeB);

    if (invalidA && invalidB) {
      return 0;
    }
    if (invalidA) {
      return 1;
    }
    if (invalidB) {
      return -1;
    }

    return timeA - timeB;
  }

  function reorderNotes(draggedId, targetId, insertBeforeTarget) {
    if (!draggedId || draggedId === targetId) {
      return;
    }

    const updatedNotes = [...notes];
    const draggedIndex = updatedNotes.findIndex((note) => note.id === draggedId);
    if (draggedIndex === -1) {
      return;
    }

    const [draggedNote] = updatedNotes.splice(draggedIndex, 1);

    if (!targetId) {
      updatedNotes.push(draggedNote);
    } else {
      const targetIndex = updatedNotes.findIndex((note) => note.id === targetId);

      if (targetIndex === -1) {
        updatedNotes.push(draggedNote);
      } else {
        const insertIndex = insertBeforeTarget ? targetIndex : targetIndex + 1;
        updatedNotes.splice(insertIndex, 0, draggedNote);
      }
    }

    notes = updatedNotes;
    persistNotes();
  }

  function clearDragIndicators() {
    notesList
      .querySelectorAll('.note--dragging, .note--drop-before, .note--drop-after')
      .forEach((element) => {
        element.classList.remove('note--dragging');
        element.classList.remove('note--drop-before');
        element.classList.remove('note--drop-after');
      });
  }

  function updateDropIndicator(pointerY) {
    notesList
      .querySelectorAll('.note--drop-before, .note--drop-after')
      .forEach((element) => {
        element.classList.remove('note--drop-before');
        element.classList.remove('note--drop-after');
      });

    const { element, insertBefore } = determineDropPosition(pointerY);
    if (!element) {
      return;
    }

    element.classList.add(insertBefore ? 'note--drop-before' : 'note--drop-after');
  }

  function determineDropPosition(pointerY) {
    if (typeof pointerY !== 'number') {
      return { element: null, insertBefore: false };
    }

    const noteElements = Array.from(notesList.querySelectorAll('.note'));

    let fallbackElement = null;
    let fallbackInsertBefore = false;

    for (const element of noteElements) {
      if (element.dataset.noteId === draggedNoteId) {
        continue;
      }

      const bounds = element.getBoundingClientRect();
      const midpoint = bounds.top + bounds.height / 2;

      if (pointerY < midpoint) {
        return { element, insertBefore: true };
      }

      fallbackElement = element;
      fallbackInsertBefore = false;
    }

    return { element: fallbackElement, insertBefore: fallbackInsertBefore };
  }

  function formatRelativeDate(date) {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    if (diffMs < 60000) {
      return 'just now';
    }

    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
      return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    }

    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  function normalizeNoteColor(color) {
    if (typeof color !== 'string') {
      return DEFAULT_NOTE_COLOR;
    }

    const trimmed = color.trim().toLowerCase();
    const migrated = LEGACY_COLOR_MAP[trimmed] || trimmed;
    return NOTE_COLOR_IDS.has(migrated) ? migrated : DEFAULT_NOTE_COLOR;
  }
})();
