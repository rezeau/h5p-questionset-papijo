'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

class FakeElement {
  constructor(className = '') {
    this.className = className;
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.classList = {
      add: () => {},
      remove: () => {},
      toggle: () => {}
    };
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    return new FakeElement(selector.slice(1));
  }

  querySelectorAll() {
    return [new FakeElement()];
  }
}

const descendants = (element) => element.children.flatMap((child) => [
  child,
  ...descendants(child)
]);

const hasClass = (element, className) =>
  element.className.split(/\s+/).includes(className);

const createHarness = ({ runnableFactory } = {}) => {
  const globalDots = [];
  const runnables = [];

  class JQueryCollection {
    constructor(elements) {
      this.elements = elements.filter(Boolean);
      this.length = this.elements.length;
      this[0] = this.elements[0];
    }

    get(index) { return this.elements[index]; }
    each(callback) {
      this.elements.forEach((element, index) => callback.call(element, index, element));
      return this;
    }
    append(...items) {
      for (const parent of this.elements) {
        for (const item of items.flatMap((value) => value instanceof JQueryCollection ? value.elements : [value])) {
          if (item) parent.appendChild(item);
        }
      }
      return this;
    }
    appendTo(target) { $(target).append(this); return this; }
    parent() { return new JQueryCollection(this.elements.map((element) => element.parentElement)); }
    children() { return new JQueryCollection(this.elements.flatMap((element) => element.children)); }
    eq(index) { return new JQueryCollection([this.elements[index]]); }
    addClass() { return this; }
    removeClass() { return this; }
    hide() { return this; }
    show() { return this; }
    remove() { return this; }
    filter() { return this; }
    attr() { return this; }
    css() { return this; }
    html() { return this; }
    focus() { return this; }
  }

  const find = (selector, context) => {
    const match = selector.match(/^\.([\w-]+)(?::eq\((\d+)\))?/);
    if (!match) return [];
    const className = match[1];
    const roots = context instanceof JQueryCollection ? context.elements : [context];
    let matches = roots.flatMap((element) => descendants(element)).filter((element) => hasClass(element, className));
    if (match[2] !== undefined) matches = [matches[Number(match[2])]];
    return matches.filter(Boolean);
  };

  function $(value, properties) {
    if (typeof value === 'string' && value.startsWith('<')) {
      const element = new FakeElement(properties?.class || '');
      if (properties?.appendTo) $(properties.appendTo).append(element);
      return new JQueryCollection([element]);
    }
    if (typeof value === 'string') {
      if (properties) return new JQueryCollection(find(value, properties));
      if (value === '.h5p-progress-dot') return new JQueryCollection(globalDots);
      return new JQueryCollection([]);
    }
    if (value instanceof JQueryCollection) return value;
    return new JQueryCollection([value]);
  }

  $.extend = (deep, target, ...sources) => {
    if (typeof deep !== 'boolean') {
      sources = [target, ...sources];
      target = deep;
      deep = false;
    }
    for (const source of sources) {
      for (const [key, value] of Object.entries(source || {})) {
        if (deep && value && typeof value === 'object' && !Array.isArray(value)) {
          target[key] = $.extend(true, target[key] || {}, value);
        }
        else if (deep && Array.isArray(value)) {
          target[key] = value.map((item) => item && typeof item === 'object' ? $.extend(true, {}, item) : item);
        }
        else {
          target[key] = value;
        }
      }
    }
    return target;
  };

  function EventDispatcher() {}
  EventDispatcher.prototype.on = () => {};
  EventDispatcher.prototype.trigger = () => {};
  EventDispatcher.prototype.isRoot = () => false;
  EventDispatcher.prototype.setActivityStarted = () => {};

  const H5P = {
    jQuery: $,
    EventDispatcher,
    Components: {
      CoverPage: () => new FakeElement('h5p-theme-quiz'),
      Navigation: ({ dots = [], navigationLength = dots.length }) => {
        const nav = new FakeElement('qs-footer');
        const localDots = Array.from(
          { length: navigationLength },
          () => new FakeElement('h5p-progress-dot answered')
        );
        const progressDots = new FakeElement('h5p-progress-dots');
        localDots.forEach((dot) => {
          progressDots.appendChild(dot);
          globalDots.push(dot);
        });
        progressDots.calls = [];
        progressDots.toggleFilledDot = (index, isFilled) => {
          if (!localDots[index]) {
            throw new RangeError(`progress dot index ${index} is outside this QuestionSet instance`);
          }
          progressDots.calls.push([index, isFilled]);
        };
        nav.progressDots = progressDots;
        nav.setCurrentIndex = () => {};
        nav.setCanShowLast = () => {};
        return nav;
      }
    },
    createUUID: (() => { let id = 0; return () => `uuid-${++id}`; })(),
    isEmpty: (value) => !value || Object.keys(value).length === 0,
    on: () => {},
    newRunnable: (question) => {
      const runnable = runnableFactory ? runnableFactory(question) : {
        on: () => {},
        attach: () => {},
        resetTask: () => {},
        getAnswerGiven: () => false,
        getScore: () => 0,
        getMaxScore: () => 1,
        getCurrentState: () => ({}),
        setActivityStarted: () => {},
        trigger: () => {}
      };
      runnables.push({ question, runnable });
      return runnable;
    },
    error: () => {},
    shuffleArray: (value) => value
  };

  const context = vm.createContext({ H5P, console, setTimeout, clearTimeout });
  vm.runInContext(
    fs.readFileSync(path.join(root, 'js', 'questionset.js'), 'utf8'),
    context,
    { filename: 'questionset.js' }
  );

  return { H5P, FakeElement, runnables };
};

test('resetTask clears only the progress dots owned by its QuestionSet instance', () => {
  const { H5P, FakeElement } = createHarness();
  const options = {
    questions: [
      { library: 'H5P.MockQuestion 1.0', params: {} },
      { library: 'H5P.MockQuestion 1.0', params: {} }
    ],
    introPage: { showIntroPage: true }
  };
  const first = new H5P.QuestionSetPapiJo(options, 1, {});
  const second = new H5P.QuestionSetPapiJo(options, 2, {});
  const firstHost = new FakeElement('host');
  const secondHost = new FakeElement('host');
  new FakeElement('parent').appendChild(firstHost);
  new FakeElement('parent').appendChild(secondHost);
  first.attach(firstHost);
  second.attach(secondHost);

  first.nav.progressDots.calls.length = 0;
  second.nav.progressDots.calls.length = 0;

  assert.doesNotThrow(() => first.resetTask());
  assert.deepEqual(first.nav.progressDots.calls, [[0, false], [1, false]]);
  assert.deepEqual(second.nav.progressDots.calls, []);
});

test('ScaleQuestion keeps authored autoCheck when the global Check override is inactive', () => {
  [undefined, true].forEach((checkButton) => {
    [false, true].forEach((autoCheck) => {
      const { H5P, runnables } = createHarness();
      const authoredQuestion = {
        library: 'H5P.ScaleQuestion 0.1',
        params: { behaviour: { autoCheck } }
      };
      const override = checkButton === undefined ? {} : { checkButton };

      new H5P.QuestionSetPapiJo({
        questions: [authoredQuestion],
        override
      }, 1, {});

      assert.equal(runnables[0].question.params.behaviour.autoCheck, autoCheck);
      assert.equal(
        Object.hasOwn(runnables[0].question.params.behaviour, 'enableCheckButton'),
        false
      );
      assert.equal(authoredQuestion.params.behaviour.autoCheck, autoCheck);
    });
  });
});

test('disabled global Check enables ScaleQuestion autoCheck before initialization', () => {
  const { H5P, runnables } = createHarness();
  const authoredQuestion = {
    library: 'H5P.ScaleQuestion 0.1',
    params: { behaviour: { autoCheck: false } }
  };

  new H5P.QuestionSetPapiJo({
    questions: [authoredQuestion],
    override: { checkButton: false }
  }, 1, {});

  assert.deepEqual(runnables[0].question.params.behaviour, {
    autoCheck: true,
    enableCheckButton: false
  });
  assert.deepEqual(authoredQuestion.params.behaviour, { autoCheck: false });
});

test('ScaleQuestion-specific Check translation preserves other child and button overrides', () => {
  const { H5P, runnables } = createHarness();

  new H5P.QuestionSetPapiJo({
    questions: [
      {
        library: 'H5P.ScaleQuestion 0.1',
        params: { behaviour: { autoCheck: false } }
      },
      {
        library: 'H5P.MultiChoice 1.16',
        params: { behaviour: {} }
      }
    ],
    override: {
      checkButton: false,
      retryButton: 'off',
      showSolutionButton: 'on'
    }
  }, 1, {});

  assert.deepEqual(runnables[0].question.params.behaviour, {
    autoCheck: true,
    enableCheckButton: false,
    enableRetry: false,
    enableSolutionsButton: true
  });
  assert.deepEqual(runnables[1].question.params.behaviour, {
    enableCheckButton: false,
    enableRetry: false,
    enableSolutionsButton: true
  });
  assert.equal(
    Object.hasOwn(runnables[1].question.params.behaviour, 'autoCheck'),
    false
  );
});

test('intermediate ScaleQuestion state keeps restricted forward navigation locked', () => {
  const listeners = new Map();
  const children = [];
  const { H5P, FakeElement } = createHarness({
    runnableFactory: () => {
      const child = {
        terminal: false,
        on: (event, callback) => listeners.set(child, { event, callback }),
        attach: () => {},
        resetTask: () => {},
        getAnswerGiven: () => child.terminal,
        getScore: () => 0,
        getMaxScore: () => 1,
        getCurrentState: () => ({ terminal: child.terminal }),
        setActivityStarted: () => {},
        trigger: () => {}
      };
      children.push(child);
      return child;
    }
  });
  const questionSet = new H5P.QuestionSetPapiJo({
    disableBackwardsNavigation: true,
    questions: [
      { library: 'H5P.ScaleQuestion 0.1', params: { behaviour: {} } },
      { library: 'H5P.MultiChoice 1.16', params: { behaviour: {} } }
    ]
  }, 1, {});
  const host = new FakeElement('host');
  new FakeElement('parent').appendChild(host);
  questionSet.attach(host);

  assert.equal(questionSet.buttons.next.disabled, true);
  const registration = listeners.get(children[0]);
  assert.equal(registration.event, 'xAPI');
  registration.callback({
    getVerb: () => 'interacted',
    data: { statement: { context: {} } }
  });
  assert.equal(children[0].getAnswerGiven(), false);
  assert.equal(questionSet.buttons.next.disabled, true);
});

test('terminal ScaleQuestion scores contribute to the QuestionSet aggregate', () => {
  const scores = [1, 0];
  const { H5P } = createHarness({
    runnableFactory: () => {
      const score = scores.shift();
      return {
        on: () => {},
        attach: () => {},
        resetTask: () => {},
        getAnswerGiven: () => true,
        getScore: () => score,
        getMaxScore: () => 1,
        getCurrentState: () => ({ terminal: true }),
        setActivityStarted: () => {},
        trigger: () => {}
      };
    }
  });
  const questionSet = new H5P.QuestionSetPapiJo({
    questions: [
      { library: 'H5P.ScaleQuestion 0.1', params: { behaviour: {} } },
      { library: 'H5P.ScaleQuestion 0.1', params: { behaviour: {} } }
    ]
  }, 1, {});

  assert.equal(questionSet.getScore(), 1);
  assert.equal(questionSet.getMaxScore(), 2);
});
