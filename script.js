(() => {
  const STORAGE_KEY = 'sticky-notes-app';
  const NOTE_COLORS = [
    { id: 'sunny', label: 'Warm yellow' },
    { id: 'blush', label: 'Soft blush' },
    { id: 'mint', label: 'Fresh mint' },
    { id: 'sky', label: 'Calm sky' },
    { id: 'lavender', label: 'Light lavender' },
  ];
  const DEFAULT_NOTE_COLOR = NOTE_COLORS[0].id;

  const noteForm = document.querySelector('#note-form');
  const titleInput = document.querySelector('#note-title');
  const contentInput = document.querySelector('#note-content');
  const submitButton = document.querySelector('.note-form__submit');
  const cancelButton = document.querySelector('.note-form__cancel');
  const searchInput = document.querySelector('#search-input');
  const notesList = document.querySelector('#notes-list');
  const emptyState = document.querySelector('#empty-state');
  const noteTemplate = document.querySelector('#note-template');
  const undoSnackbar = document.querySelector('#undo-snackbar');
  const undoMessage = document.querySelector('#undo-message');
  const undoButton = document.querySelector('#undo-button');

  let notes = loadNotes();
  let editingNoteId = null;
  let draggedNoteId = null;
  let lastDeletedNote = null;
  let undoTimerId = null;
  let targetedNoteId = null;

  renderNotes();

  noteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title || !content) {
      return;
    }

    if (editingNoteId) {
      updateNote(editingNoteId, { title, content });
    } else {
      createNote({ title, content });
    }

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

  undoButton.addEventListener('click', () => {
    if (!lastDeletedNote) {
      return;
    }

    const { note, index } = lastDeletedNote;
    const insertIndex = Math.min(index, notes.length);
    notes = [...notes];
    notes.splice(insertIndex, 0, note);
    persistNotes();
    renderNotes();
    clearUndoState();
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

    const noteElement = event.target.closest('.note');
    updateDropIndicator(noteElement, event.clientY);
  });

  notesList.addEventListener('drop', (event) => {
    if (!draggedNoteId) {
      return;
    }

    event.preventDefault();

    const dropTarget = event.target.closest('.note');
    const targetId = dropTarget ? dropTarget.dataset.noteId : null;
    const shouldInsertBefore = dropTarget
      ? event.clientY < dropTarget.getBoundingClientRect().top + dropTarget.offsetHeight / 2
      : false;

    reorderNotes(draggedNoteId, targetId, shouldInsertBefore);
    clearDragIndicators();
    draggedNoteId = null;
    renderNotes();
  });

  function createNote({ title, content, color = DEFAULT_NOTE_COLOR }) {
    const newNote = {
      id: crypto.randomUUID(),
      title,
      content,
      color,
      updatedAt: new Date().toISOString(),
    };

    notes = [newNote, ...notes];
    persistNotes();
  }

  function updateNote(id, changes) {
    notes = notes.map((note) =>
      note.id === id
        ? { ...note, ...changes, updatedAt: new Date().toISOString() }
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

    editingNoteId = note.id;
    titleInput.value = note.title;
    contentInput.value = note.content;
    submitButton.textContent = 'Update note';
    cancelButton.hidden = false;
    highlightNote(id);
    titleInput.focus();
  }

  function resetForm() {
    noteForm.reset();
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
          color:
            typeof note.color === 'string' && NOTE_COLORS.some((c) => c.id === note.color)
              ? note.color
              : DEFAULT_NOTE_COLOR,
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
    const { note } = deleted;
    lastDeletedNote = deleted;
    undoMessage.textContent = `Deleted "${note.title}"`;
    undoSnackbar.classList.add('undo-snackbar--visible');
    undoSnackbar.removeAttribute('aria-hidden');

    if (undoTimerId) {
      clearTimeout(undoTimerId);
    }

    undoTimerId = window.setTimeout(() => {
      clearUndoState();
    }, 5000);
  }

  function clearUndoState() {
    if (undoTimerId) {
      clearTimeout(undoTimerId);
      undoTimerId = null;
    }

    lastDeletedNote = null;
    undoSnackbar.classList.remove('undo-snackbar--visible');
    undoSnackbar.setAttribute('aria-hidden', 'true');
  }

  function renderNotes() {
    clearHighlights();
    const query = searchInput.value.trim().toLowerCase();

    const filteredNotes = query
      ? notes.filter((note) =>
          note.title.toLowerCase().includes(query) ||
          note.content.toLowerCase().includes(query)
        )
      : notes;

    notesList.innerHTML = '';

    if (filteredNotes.length === 0) {
      emptyState.hidden = false;
      applyTargetedState();
      return;
    }

    emptyState.hidden = true;

    filteredNotes.forEach((note) => {
      const node = noteTemplate.content.firstElementChild.cloneNode(true);
      const titleEl = node.querySelector('.note__title');
      const contentEl = node.querySelector('.note__content');
      const timestampEl = node.querySelector('.note__timestamp');
      const paletteEl = node.querySelector('.note__palette');

      node.dataset.noteId = note.id;
      node.setAttribute('draggable', 'true');
      node.dataset.color = note.color || DEFAULT_NOTE_COLOR;
      titleEl.textContent = note.title;
      contentEl.textContent = note.content;

      const updatedDate = new Date(note.updatedAt);
      timestampEl.dateTime = updatedDate.toISOString();
      timestampEl.textContent = `Updated ${formatRelativeDate(updatedDate)}`;

      renderPalette(paletteEl, note);

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
  }

  function renderPalette(container, note) {
    if (!container) {
      return;
    }

    container.innerHTML = '';

    NOTE_COLORS.forEach((color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note__color';
      const isActive = color.id === (note.color || DEFAULT_NOTE_COLOR);
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

  function updateDropIndicator(targetElement, pointerY) {
    notesList
      .querySelectorAll('.note--drop-before, .note--drop-after')
      .forEach((element) => {
        element.classList.remove('note--drop-before');
        element.classList.remove('note--drop-after');
      });

    if (!targetElement || targetElement.dataset.noteId === draggedNoteId) {
      return;
    }

    const bounds = targetElement.getBoundingClientRect();
    const shouldInsertBefore = pointerY < bounds.top + bounds.height / 2;

    targetElement.classList.add(
      shouldInsertBefore ? 'note--drop-before' : 'note--drop-after'
    );
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
})();
