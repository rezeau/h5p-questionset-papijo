H5P = H5P || {};

/**
 * Will render a Question with multiple choices for answers.
 *
 * Events provided:
 * - h5pQuestionSetFinished: Triggered when a question is finished. (User presses Finish-button)
 *
 * @param {Array} options
 * @param {int} contentId
 * @param {Object} contentData
 * @returns {H5P.QuestionSet} Instance
 */
H5P.QuestionSetPapiJo = function (options, contentId, contentData) {
  if (!(this instanceof H5P.QuestionSetPapiJo)) {
    return new H5P.QuestionSetPapiJo(options, contentId, contentData);
  }
  H5P.EventDispatcher.call(this);
  var $ = H5P.jQuery;
  var self = this;
  this.contentId = contentId;

  var defaults = {
    initialQuestion: 0,
    progressType: 'dots',
    passPercentage: 50,
    questions: [],
    introPage: {
      showIntroPage: false,
      title: '',
      introduction: '',
      startButtonText: 'Start'
    },
    texts: {
      prevButton: 'Previous question',
      nextButton: 'Next question',
      finishButton: 'Finish',
      submitButton: 'Submit',
      textualProgress: 'Question: @current of @total questions',
      jumpToQuestion: 'Question %d of %total',
      questionLabel: 'Question',
      readSpeakerProgress: 'Question @current of @total',
      unansweredText: 'Unanswered',
      answeredText: 'Answered',
      currentQuestionText: 'Current question',
      navigationLabel: 'Questions',
      QuestionSetPapiJoInstruction: 'Choose question to display'
    },
    endGame: {
      showResultPage: true,
      noResultMessage: 'Finished',
      message: 'Your result:',
      scoreBarLabel: 'You got @finals out of @totals points',
      oldFeedback: {
        successGreeting: '',
        successComment: '',
        failGreeting: '',
        failComment: ''
      },
      overallFeedback: [],
      finishButtonText: 'Finish',
      submitButtonText: 'Submit',
      solutionButtonText: 'Show solution',
      retryButtonText: 'Retry',
      showAnimations: false,
      skipButtonText: 'Skip video',
      showSolutionButton: true,
      showRetryButton: true
    },
    override: {},
    disableBackwardsNavigation: false
  };
  this.isSubmitting = contentData
         && (contentData.isScoringEnabled || contentData.isReportingEnabled);
  var params = $.extend(true, {}, defaults, options);

  var initialParams = $.extend(true, {}, defaults, options);
  var poolOrder; // Order of questions in a pool
  var currentQuestion = 0;
  var questionInstances = [];
  var questionOrder; //Stores order of questions to allow resuming of question set
  var $myDom;
  var scoreBar;
  var up;
  var renderSolutions = false;
  var showingSolutions = false;
  contentData = contentData || {};

  // Need to check with isEmpty, as {} == true
  this.hasPrevState = !H5P.isEmpty(contentData.previousState);

  // Bring question set up to date when resuming
  if (self.hasPrevState) {
    if (contentData.previousState.progress !== undefined) {
      currentQuestion = contentData.previousState.progress;
    }
    questionOrder = contentData.previousState.order;
  }

  /**
   * Randomizes questions in an array and updates an array containing their order
   * @param  {array} questions
   * @return {Object.<array, array>} questionOrdering
   */
  var randomizeQuestionOrdering = function (questions) {
    // Use a previous order if it exists
    if (self.hasPrevState && contentData.previousState.order) {
      questions = questions.slice(0, questionOrder.length);

      return {
        questions: questions,
        questionOrder: questionOrder,
      }
    }

    // Save the original order of the questions in a multidimensional array [[question0,0],[question1,1]...
    var questionOrdering = questions.map(function (questionInstance, index) {
      return [questionInstance, index];
    });

    // Shuffle the multidimensional array
    questionOrdering = H5P.shuffleArray(questionOrdering);

    // Retrieve question objects from the first index
    questions = [];
    for (var i = 0; i < questionOrdering.length; i++) {
      questions[i] = questionOrdering[i][0];
    }

    // Retrieve the new shuffled order from the second index
    var newOrder = [];
    for (var j = 0; j < questionOrdering.length; j++) {
      newOrder[j] = questionOrdering[j][1];
    }

    // Return the questions in their new order *with* their new indexes
    return {
      questions: questions,
      questionOrder: newOrder
    };
  };

  // Create a pool (a subset) of questions if necessary
  if (params.poolSize > 0) {

    // If a previous pool exists, recreate it
    if (self.hasPrevState && contentData.previousState.poolOrder) {
      poolOrder = contentData.previousState.poolOrder;

      // Recreate the pool from the saved data
      var pool = [];
      for (var i = 0; i < poolOrder.length; i++) {
        pool[i] = params.questions[poolOrder[i]];
      }

      // Replace original questions with just the ones in the pool
      params.questions = pool;
    }
    else { // Otherwise create a new pool
      // Randomize and get the results
      var poolResult = randomizeQuestionOrdering(params.questions);
      var poolQuestions = poolResult.questions;
      poolOrder = poolResult.questionOrder;

      // Discard extra questions

      poolQuestions = poolQuestions.slice(0, params.poolSize);
      poolOrder = poolOrder.slice(0, params.poolSize);

      // Replace original questions with just the ones in the pool
      params.questions = poolQuestions;
    }
  }

  // Set overrides for questions
  var override;
  if (params.override.showSolutionButton || params.override.retryButton || params.override.checkButton === false) {
    override = {};
    if (params.override.showSolutionButton) {
      // Force "Show solution" button to be on or off for all interactions
      override.enableSolutionsButton =
          (params.override.showSolutionButton === 'on' ? true : false);
    }

    if (params.override.retryButton) {
      // Force "Retry" button to be on or off for all interactions
      override.enableRetry =
          (params.override.retryButton === 'on' ? true : false);
    }

    if (params.override.checkButton === false) {
      // Force "Check" button to be on or off for all interactions
      override.enableCheckButton = params.override.checkButton;
    }
  }

  /**
   * Generates question instances from H5P objects
   *
   * @param  {object} questions H5P content types to be created as instances
   * @return {array} Array of questions instances
   */
  var createQuestionInstancesFromQuestions = function (questions) {
    var result = [];
    // Create question instances from questions
    // Instantiate question instances
    for (var i = 0; i < questions.length; i++) {

      var question;
      // If a previous order exists, use it
      if (questionOrder !== undefined) {
        question = questions[questionOrder[i]];
      }
      else {
        // Use a generic order when initialzing for the first time
        question = questions[i];
      }

      if (override) {
        // Extend subcontent with the overrided settings.
        $.extend(question.params.behaviour, override);
      }

      question.params = question.params || {};
      var hasAnswers = self.hasPrevState && contentData.previousState.answers;
      var questionInstance = H5P.newRunnable(question, contentId, undefined, undefined,
        {
          previousState: hasAnswers ? contentData.previousState.answers[i] : undefined,
          parent: self
        });
      questionInstance.on('resize', function () {
        up = true;
        self.trigger('resize');
      });
      result.push(questionInstance);
    }

    return result;
  };

  // Create question instances from questions given by params
  questionInstances = createQuestionInstancesFromQuestions(params.questions);
  params.noOfQuestionAnswered = 0;
  if (self.hasPrevState) {
    // get numbers of questions answered by user
    if (contentData.previousState.answers) {
      for (var i = 0; i < questionInstances.length; i++) {
        let answered = questionInstances[i].getAnswerGiven();
        if (answered){
          params.noOfQuestionAnswered++;
        }
      }
    }
  }

  // Create html for intro page layout
  self.$introPage = '';
  if (params.introPage.showIntroPage && params.noOfQuestionAnswered === 0) {
    self.$introPage = $('<div>', {
      class: 'intro-page'
    });
  
    if (params.introPage.title) {
      $('<div>', {
        class: 'title',
        html: '<h1>' + 
              params.introPage.title + 
              '</h1>',
        appendTo: self.$introPage
      });
    }

    if (params.introPage.introduction) {
      $('<div>', {
        class: 'introduction',
        html: params.introPage.introduction,
        appendTo: self.$introPage
      });
    }

    self.$introButtonsContainer = $('<div>', {
      class: 'buttons',
      appendTo: self.$introPage
    });
  
    $('<button>', {
      class: 'qs-startbutton h5p-joubelui-button h5p-button',
      html: params.introPage.startButtonText,
      appendTo: self.$introButtonsContainer
    });
  }

  // Create html for progress announcer
  self.$progressAnnouncer = $('<div>', {
    class: 'qs-progress-announcer',
    'aria-live': 'polite',
  });

  // Create html for QuestionSetPapiJo
  self.$questionsContainer = $('<div>', {
    class: 'QuestionSetPapiJo ' + 
    ((params.introPage.showIntroPage && params.noOfQuestionAnswered === 0) ? 'hidden' : ''),
  });

  const tabIDs = Array.from({length: params.questions.length}, () => H5P.createUUID());
  const tabPanelIDs = Array.from({length: params.questions.length}, () => H5P.createUUID());

  for (let i=0; i<params.questions.length; i++) {
    $('<div>', {
      class: 'question-container',
      role: 'tabpanel',
      id: tabPanelIDs[i],
      'aria-labelledby': tabIDs[i],
      appendTo: self.$questionsContainer
    });
  }

  self.$footer = $('<div>', {
    class: 'qs-footer',
    appendTo: self.$questionsContainer
  });

  self.$progressBar = $('<div>', {
    class: 'qs-progress',
    role: 'navigation',
    'aria-label': params.texts.navigationLabel,
    appendTo: self.$footer
  });

  if (params.progressType == "dots") {
    self.$dotsContainer = $('<ul>', {
      class: 'dots-container',
      role: 'tablist',
      'aria-label': params.texts.QuestionSetPapiJoInstruction,
      appendTo: self.$progressBar
    });

    for (let i=0; i<params.questions.length; i++) {
      $('<li>', {
        class: 'progress-item',
        html: '<a href="#" class= "progress-dot unanswered ' + 
              (params.disableBackwardsNavigation ? 'disabled' : '') +
              '" ' +
              'id="' +
              tabIDs[i] +
              '" ' +
              'aria-label=' +
                '"' +
                params.texts.jumpToQuestion.replace("%d", i + 1).replace("%total", params.questions.length) +
                ', ' +
                params.texts.unansweredText +
                '" ' +
              'tabindex="-1" ' +
              (params.disableBackwardsNavigation ? 'aria-disabled="true"' : '') +
              ' aria-controls="' +
              tabPanelIDs[i] +
              '" ' +
              'aria-selected="false" ' +
              'role="tab"></a>',
        appendTo: self.$dotsContainer
      })
    }
  }

  else if (params.progressType == "textual") {
    $('<span>', {
      class: 'progress-text',
      appendTo: self.$progressBar
    })
}

  // Randomize questions only on instantiation
  if (params.randomQuestions && !self.hasPrevState) {
    var result = randomizeQuestionOrdering(questionInstances);
    questionInstances = result.questions;
    questionOrder = result.questionOrder;
  }

  // Resize all interactions on resize
  self.on('resize', function () {
    if (up) {
      // Prevent resizing the question again.
      up = false;
      return;
    }

    for (var i = 0; i < questionInstances.length; i++) {
      questionInstances[i].trigger('resize');
    }
  });

  // Update button state.
  var _updateButtons = function () {
    // Verify that current question is answered when backward nav is disabled
    if (params.disableBackwardsNavigation) {
      if (questionInstances[currentQuestion].getAnswerGiven() &&
          questionInstances.length-1 !== currentQuestion) {
        questionInstances[currentQuestion].showButton('next');
      }
      else {
        questionInstances[currentQuestion].hideButton('next');
      }
    }

    var answered = true;
    for (var i = questionInstances.length - 1; i >= 0; i--) {
      answered = answered && (questionInstances[i]).getAnswerGiven();
    }

    if (currentQuestion === (params.questions.length - 1) &&
        questionInstances[currentQuestion]) {
      if (answered) {
        questionInstances[currentQuestion].showButton('finish');
      }
      else {
        questionInstances[currentQuestion].hideButton('finish');
      }
    }
  };

  var _showQuestion = function (questionNumber, preventAnnouncement) {
    // Sanitize input.
    if (questionNumber < 0) {
      questionNumber = 0;
    }
    if (questionNumber >= params.questions.length) {
      questionNumber = params.questions.length - 1;
    }

    currentQuestion = questionNumber;

    // Hide all questions
    $('.question-container', $myDom).hide().eq(questionNumber).show();

    if (questionInstances[questionNumber]) {
      // Trigger resize on question in case the size of the QS has changed.
      var instance = questionInstances[questionNumber];
      instance.setActivityStarted();
      if (instance.$ !== undefined) {
        instance.trigger('resize');
      }
    }

    // Update progress indicator
    // Test if current has been answered.
    if (params.progressType === 'textual') {
      $('.progress-text', $myDom).text(params.texts.textualProgress.replace("@current", questionNumber+1).replace("@total", params.questions.length));
    }
    else {
      // Set currentNess
      var previousQuestion = $('.progress-dot.current', $myDom).parent().index();
      if (previousQuestion >= 0) {
        toggleCurrentDot(previousQuestion, false);
        toggleAnsweredDot(previousQuestion, questionInstances[previousQuestion].getAnswerGiven());
      }
      toggleCurrentDot(questionNumber, true);
    }

    if (!preventAnnouncement) {
      // Announce question number of total, must use timeout because of buttons logic
      setTimeout(function () {
        var humanizedProgress = params.texts.readSpeakerProgress
          .replace('@current', (currentQuestion + 1).toString())
          .replace('@total', questionInstances.length.toString());

        self.$progressAnnouncer.html(humanizedProgress);

        if (instance && instance.readFeedback) {
          instance.readFeedback();
        }
      }, 0);
    }

    // Remember where we are
    _updateButtons();
    self.trigger('resize');
    return currentQuestion;
  };

  /**
   * Show solutions for subcontent, and hide subcontent buttons.
   * Used for contracts with integrated content.
   * @public
   */
  var showSolutions = function () {
    showingSolutions = true;
    for (var i = 0; i < questionInstances.length; i++) {

      // Enable back and forth navigation in solution mode
      toggleDotsNavigation(true);
      if (i < questionInstances.length - 1) {
        questionInstances[i].showButton('next');
      }
      if (i > 0) {
        questionInstances[i].showButton('prev');
      }

      try {
        // Do not read answers
        questionInstances[i].toggleReadSpeaker(true);
        questionInstances[i].showSolutions();
        questionInstances[i].toggleReadSpeaker(false);
      }
      catch (error) {
        H5P.error("subcontent does not contain a valid showSolutions function");
        H5P.error(error);
      }
    }
  };

  /**
   * Toggles whether dots are enabled for navigation
   */
  var toggleDotsNavigation = function (enable) {
    $('.progress-dot', $myDom).each(function () {
      $(this).toggleClass('disabled', !enable);
      $(this).attr('aria-disabled', enable ? 'false' : 'true');
      // Remove tabindex
      if (!enable) {
        $(this).attr('tabindex', '-1');
      }
    });
  };

  /**
   * Resets the task and every subcontent task.
   * Used for contracts with integrated content.
   * @public
   * @param {boolean} moveFocus True to move the focus to first option
   * This prevents loss of focus if reset from within content
   */
  this.resetTask = function (moveFocus = false) {

    // Clear previous state to ensure questions are created cleanly
    contentData.previousState = {};
    self.hasPrevState = false;
    questionOrder = undefined;

    showingSolutions = false;

    for (var i = 0; i < questionInstances.length; i++) {
      try {
        questionInstances[i].resetTask();

        // Hide back and forth navigation in normal mode
        if (params.disableBackwardsNavigation) {
          toggleDotsNavigation(false);

          // Check if first question is answered by default
          if (i === 0 && questionInstances[i].getAnswerGiven()) {
            questionInstances[i].showButton('next');
          }
          else {
            questionInstances[i].hideButton('next');
          }

          questionInstances[i].hideButton('prev');
        }
      }
      catch (error) {
        H5P.error("subcontent does not contain a valid resetTask function");
        H5P.error(error);
      }
    }

    // Hide finish button
    questionInstances[questionInstances.length - 1].hideButton('finish');

    // Mark all tasks as unanswered:
    $('.progress-dot').each(function (idx) {
      toggleAnsweredDot(idx, false);
    });

    //Force the last page to be reRendered
    rendered = false;

    if (params.poolSize > 0) {

      // Make new pool from params.questions
      // Randomize and get the results
      var poolResult = randomizeQuestionOrdering(initialParams.questions);
      var poolQuestions = poolResult.questions;
      poolOrder = poolResult.questionOrder;

      // Discard extra questions
      poolQuestions = poolQuestions.slice(0, params.poolSize);
      poolOrder = poolOrder.slice(0, params.poolSize);

      // Replace original questions with just the ones in the pool
      params.questions = poolQuestions;

      // Recreate the question instances
      questionInstances = createQuestionInstancesFromQuestions(params.questions);

      // Update buttons
      initializeQuestion();

    }
    else if (params.randomQuestions) {
      randomizeQuestions();
    }

    // Reset currentQuestion
    currentQuestion = 0;

    $myDom.children().hide();
    var $intro = $('.intro-page', $myDom);

    if ($intro.length) {
      // Show intro
      $('.intro-page', $myDom).show();
      if (moveFocus) {
        $('.qs-startbutton', $myDom).focus();
      }
    }
    else {
      // Show first question
      $('.QuestionSetPapiJo', $myDom).show();
      _showQuestion(params.initialQuestion);

      if (moveFocus) {
        // Focus first tabbable element
        $myDom[0].querySelectorAll(
          'audio, button, input, select, textarea, video, [contenteditable], [href], [tabindex="0"]'
        )[0].focus();
      }
    }
  };

  var rendered = false;

  this.reRender = function () {
    rendered = false;
  };

  /**
   * Randomizes question instances
   */
  var randomizeQuestions = function () {
    // Recreate questioninstances in original order
    questionInstances = createQuestionInstancesFromQuestions(params.questions);

    // Scramble them
    var result = randomizeQuestionOrdering(questionInstances);
    questionInstances = result.questions;
    questionOrder = result.questionOrder;

    // Update buttons
    initializeQuestion();
  };

  var moveQuestion = function (direction) {
    if (params.disableBackwardsNavigation && !questionInstances[currentQuestion].getAnswerGiven()) {
      questionInstances[currentQuestion].hideButton('next');
      questionInstances[currentQuestion].hideButton('finish');
      return;
    }

    if (currentQuestion + direction >= questionInstances.length) {
      toggleCurrentDot(currentQuestion, false);
      toggleAnsweredDot(currentQuestion, questionInstances[currentQuestion].getAnswerGiven());
      _displayEndGame();
    }
    else {
      // Allow movement if backward navigation enabled or answer given
      _showQuestion(currentQuestion + direction);
    }

    // Trigger xAPI
    self.triggerXAPIProgressed();
  };

  /**
   * Toggle answered state of dot at given index
   * @param {number} dotIndex Index of dot
   * @param {boolean} isAnswered True if is answered, False if not answered
   */
  var toggleAnsweredDot = function (dotIndex, isAnswered) {
    var $el = $('.progress-dot:eq(' + dotIndex +')', $myDom);

    // Skip current button
    if ($el.hasClass('current')) {
      return;
    }

    // Ensure boolean
    isAnswered = !!isAnswered;

    var label = params.texts.jumpToQuestion
      .replace('%d', (dotIndex + 1).toString())
      .replace('%total', $('.progress-dot', $myDom).length) +
      ', ' +
      (isAnswered ? params.texts.answeredText : params.texts.unansweredText);

    $el.toggleClass('unanswered', !isAnswered)
      .toggleClass('answered', isAnswered)
      .attr('aria-label', label);
  };

  /**
   * Toggle current state of dot at given index
   * @param dotIndex
   * @param isCurrent
   */
  var toggleCurrentDot = function (dotIndex, isCurrent) {
    var $el = $('.progress-dot:eq(' + dotIndex +')', $myDom);
    var texts = params.texts;
    var label = texts.jumpToQuestion
      .replace('%d', (dotIndex + 1).toString())
      .replace('%total', $('.progress-dot', $myDom).length);

    if (!isCurrent) {
      var isAnswered = $el.hasClass('answered');
      label += ', ' + (isAnswered ? texts.answeredText : texts.unansweredText);
    }
    else {
      label += ', ' + texts.currentQuestionText;
    }

    var disabledTabindex = params.disableBackwardsNavigation && !showingSolutions;
    $el.toggleClass('current', isCurrent)
      .attr('aria-label', label)
      .attr('tabindex', isCurrent && !disabledTabindex ? 0 : -1)
      .attr('aria-selected', isCurrent && !disabledTabindex);
  };

  var _displayEndGame = function () {
    $('.progress-dot.current', $myDom).removeClass('current');
    if (rendered) {
      $myDom.children().hide().filter('.QuestionSetPapiJo-results').show();
      self.trigger('resize');
      return;
    }
    //Remove old score screen.
    $myDom.children().hide().filter('.QuestionSetPapiJo-results').remove();
    rendered = true;

    // Get total score.
    var finals = self.getScore();
    var totals = self.getMaxScore();

    var scoreString = H5P.Question.determineOverallFeedback(params.endGame.overallFeedback, finals / totals).replace('@score', finals).replace('@total', totals);
    var success = ((100 * finals / totals) >= params.passPercentage);

    /**
     * Makes our buttons behave like other buttons.
     *
     * @private
     * @param {string} classSelector
     * @param {function} handler
     */
    var hookUpButton = function (classSelector, handler) {
      $(classSelector, $myDom).click(handler).keypress(function (e) {
        if (e.which === 32) {
          handler();
          e.preventDefault();
        }
      });
    };

    var displayResults = function () {
      self.triggerXAPICompleted(self.getScore(), self.getMaxScore(), success);

      var eparams = {
        message: params.endGame.showResultPage ? params.endGame.message : params.endGame.noResultMessage,
        comment: params.endGame.showResultPage ? (success ? params.endGame.oldFeedback.successGreeting : params.endGame.oldFeedback.failGreeting) : undefined,
        resulttext: params.endGame.showResultPage ? (success ? params.endGame.oldFeedback.successComment : params.endGame.oldFeedback.failComment) : undefined,
        finishButtonText: (self.isSubmitting) ? params.endGame.submitButtonText : params.endGame.finishButtonText,
        solutionButtonText: params.endGame.solutionButtonText,
        retryButtonText: params.endGame.retryButtonText
      };

      // Create html for end screen
      self.$resultPage = $('<div>', {
        'class': 'QuestionSetPapiJo-results'
      });
    
      $('<div>', {
        class: 'greeting',
        html: eparams.message,
        appendTo: self.$resultPage
      });
    
      $('<div>', {
        class: 'feedback-section',
        html: '<div class="feedback-scorebar"></div>' +
              '<div class="feedback-text"></div>',
        appendTo: self.$resultPage
      });
    
      if (params.comment) {
        $('<div>', {
          'class': 'result-header',
          html: eparams.comment,
          appendTo: self.$resultPage
        });
      }
    
      if (params.resulttext) {
        $('<div>', {
          class: 'result-text',
          html: eparams.resulttext,
          appendTo: self.$resultPage
        });
      }
      
      self.$buttonsContainer = $('<div>', {
        class: 'buttons',
        appendTo: self.$resultPage
      });

      if (params.endGame.showSolutionButton) {
        $('<button>', {
          class: 'h5p-joubelui-button h5p-button qs-solutionbutton',
          type: 'button',
          html: eparams.solutionButtonText,
          appendTo: self.$buttonsContainer
        });
      }

      if (params.endGame.showRetryButton) {
        $('<button>', {
          class: 'h5p-joubelui-button h5p-button qs-retrybutton',
          type: 'button',
          html: eparams.retryButtonText,
          appendTo: self.$buttonsContainer
        })
      }

      // Show result page.
      $myDom.children().hide();
      $myDom.append(self.$resultPage);

      if (params.endGame.showResultPage) {
        hookUpButton('.qs-solutionbutton', function () {
          showSolutions();
          $myDom.children().hide().filter('.QuestionSetPapiJo').show();
          _showQuestion(params.initialQuestion);
        });
        hookUpButton('.qs-retrybutton', function () {
          self.resetTask(true);
        });

        if (scoreBar === undefined) {
          scoreBar = H5P.JoubelUI.createScoreBar(totals);
        }
        scoreBar.appendTo($('.feedback-scorebar', $myDom));
        $('.feedback-text', $myDom).html(scoreString);

        // Announce that the question set is complete
        setTimeout(function () {
          self.$progressAnnouncer
            .html(eparams.message + 
                  scoreString + '.' +
                  (params.endGame.scoreBarLabel).replace('@finals', finals).replace('@totals', totals) + '.' +
                  eparams.comment + '.' +
                  eparams.resulttext);

          scoreBar.setMaxScore(totals);
          scoreBar.setScore(finals);
        }, 0);
      }
      else {
        // Remove buttons and feedback section
        $('.qs-solutionbutton, .qs-retrybutton, .feedback-section', $myDom).remove();
      }

      self.trigger('resize');
    };

    if (params.endGame.showAnimations) {
      var videoData = success ? params.endGame.successVideo : params.endGame.failVideo;
      if (videoData) {
        $myDom.children().hide();
        var $videoContainer = $('<div class="video-container"></div>').appendTo($myDom);

        var video = new H5P.Video({
          sources: videoData,
          fitToWrapper: true,
          controls: false,
          autoplay: false
        }, contentId);
        video.on('stateChange', function (event) {
          if (event.data === H5P.Video.ENDED) {
            displayResults();
            $videoContainer.hide();
          }
        });
        video.attach($videoContainer);
        // Resize on video loaded
        video.on('loaded', function () {
          self.trigger('resize');
        });
        video.play();

        if (params.endGame.skippable) {
          $('<a class="h5p-joubelui-button h5p-button skip">' + params.endGame.skipButtonText + '</a>').click(function () {
            video.pause();
            $videoContainer.hide();
            displayResults();
          }).appendTo($videoContainer);
        }

        return;
      }
    }
    // Trigger finished event.
    displayResults();
    self.trigger('resize');
  };

  var registerImageLoadedListener = function (question) {
    H5P.on(question, 'imageLoaded', function () {
      self.trigger('resize');
    });
  };

  /**
   * Initialize a question and attach it to the DOM
   *
   */
  function initializeQuestion() {
    // Attach questions
    for (var i = 0; i < questionInstances.length; i++) {
      var question = questionInstances[i];

      // Make sure styles are not being added twice
      $('.question-container:eq(' + i + ')', $myDom).attr('class', 'question-container');

      question.attach($('.question-container:eq(' + i + ')', $myDom));

      // Listen for image resize
      registerImageLoadedListener(question);

      // Add finish button
      const finishButtonText = (self.isSubmitting) ? params.texts.submitButton : params.texts.finishButton
      question.addButton('finish', finishButtonText,
        moveQuestion.bind(this, 1), false);

      // Add next button
      question.addButton('next', '', moveQuestion.bind(this, 1),
        !params.disableBackwardsNavigation || !!question.getAnswerGiven(), {
          href: '#', // Use href since this is a navigation button
          'aria-label': params.texts.nextButton
        });

      // Add previous button
      question.addButton('prev', '', moveQuestion.bind(this, -1),
        !(questionInstances[0] === question || params.disableBackwardsNavigation), {
          href: '#', // Use href since this is a navigation buttonq
          'aria-label': params.texts.prevButton
        });

      // Hide next button if it is the last question
      if (questionInstances[questionInstances.length -1] === question) {
        question.hideButton('next');
      }

      question.on('xAPI', function (event) {
        var shortVerb = event.getVerb();
        if (shortVerb === 'interacted' ||
          shortVerb === 'answered' ||
          shortVerb === 'attempted') {
          toggleAnsweredDot(currentQuestion,
            questionInstances[currentQuestion].getAnswerGiven());
          _updateButtons();
        }
        if (shortVerb === 'completed') {
          // An activity within this activity is not allowed to send completed events
          event.setVerb('answered');
        }
        if (event.data.statement.context.extensions === undefined) {
          event.data.statement.context.extensions = {};
        }
        event.data.statement.context.extensions['http://id.tincanapi.com/extension/ending-point'] = currentQuestion + 1;
      });

      // Mark question if answered
      toggleAnsweredDot(i, question.getAnswerGiven());
    }
  }

  this.attach = function (target) {
    if (this.isRoot()) {
      this.setActivityStarted();
    }
    if (typeof(target) === "string") {
      $myDom = $('#' + target);
    }
    else {
      $myDom = $(target);
    }

    // Render own DOM into target.
    $myDom.children().remove();
    $myDom.append(self.$introPage, self.$questionsContainer);
    $myDom.parent().append(self.$progressAnnouncer);

    if (params.backgroundImage !== undefined) {
      $myDom.css({
        overflow: 'hidden',
        background: '#fff url("' + H5P.getPath(params.backgroundImage.path, contentId) + '") no-repeat 50% 50%',
        backgroundSize: '100% auto'
      });
    }

    if (params.introPage.backgroundImage !== undefined) {
      var $intro = $myDom.find('.intro-page');
      if ($intro.length) {
        var bgImg = params.introPage.backgroundImage;
        var bgImgRatio = (bgImg.height / bgImg.width);
        $intro.css({
          background: '#fff url("' + H5P.getPath(bgImg.path, contentId) + '") no-repeat 50% 50%',
          backgroundSize: 'auto 100%',
          minHeight: bgImgRatio * +window.getComputedStyle($intro[0]).width.replace('px','')
        });
      }
    }

    initializeQuestion();

    // Allow other libraries to add transitions after the questions have been inited
    $('.QuestionSetPapiJo', $myDom).addClass('started');

    $('.qs-startbutton', $myDom)
      .click(function () {
        $(this).parents('.intro-page').hide();
        $('.QuestionSetPapiJo', $myDom).show();
        _showQuestion(params.initialQuestion);
        event.preventDefault();
      })
      .keydown(function (event) {
        switch (event.which) {
          case 13: // Enter
          case 32: // Space
            $(this).parents('.intro-page').hide();
            $('.QuestionSetPapiJo', $myDom).show();
            _showQuestion(params.initialQuestion);
            event.preventDefault();
        }
      });

    /**
     * Triggers changing the current question.
     *
     * @private
     * @param {Object} [event]
     */
    var handleProgressDotClick = function (event) {
      // Disable dots when backward nav disabled
      event.preventDefault();
      if (params.disableBackwardsNavigation && !showingSolutions) {
        return;
      }
      _showQuestion($(this).parent().index());

      // Trigger xAPI
      self.triggerXAPIProgressed();
    };

    // Set event listeners.
    $('.progress-dot', $myDom).click(handleProgressDotClick).keydown(function (event) {
      var $this = $(this);
      switch (event.which) {
        case 13: // Enter
        case 32: // Space
          handleProgressDotClick.call(this, event);
          break;

        case 37: // Left Arrow
        case 38: // Up Arrow
          // Go to previous dot
          var $prev = $this.parent().prev();
          if ($prev.length) {
            $prev.children('a').attr('tabindex', '0').focus();
            $this.attr('tabindex', '-1');
          }
          break;

        case 39: // Right Arrow
        case 40: // Down Arrow
          // Go to next dot
          var $next = $this.parent().next();
          if ($next.length) {
            $next.children('a').attr('tabindex', '0').focus();
            $this.attr('tabindex', '-1');
          }
          break;
      }
    });



    // Hide all but current question
    _showQuestion(currentQuestion, true);

    if (renderSolutions) {
      showSolutions();
    }
    // Update buttons in case they have changed (restored user state)
    _updateButtons();

    this.trigger('resize');

    return this;
  };

  // Get current score for QuestionSetPapiJo.
  this.getScore = function () {
    var score = 0;
    for (var i = questionInstances.length - 1; i >= 0; i--) {
      score += questionInstances[i].getScore();
    }
    return score;
  };

  // Get total score possible for QuestionSetPapiJo.
  this.getMaxScore = function () {
    var score = 0;
    for (var i = questionInstances.length - 1; i >= 0; i--) {
      score += questionInstances[i].getMaxScore();
    }
    return score;
  };

  /**
   * @deprecated since version 1.9.2
   * @returns {number}
   */
  this.totalScore = function () {
    return this.getMaxScore();
  };

  /**
   * Gather copyright information for the current content.
   *
   * @returns {H5P.ContentCopyrights}
   */
  this.getCopyrights = function () {
    var info = new H5P.ContentCopyrights();

    // IntroPage Background
    if (params.introPage !== undefined && params.introPage.backgroundImage !== undefined && params.introPage.backgroundImage.copyright !== undefined) {
      var introBackground = new H5P.MediaCopyright(params.introPage.backgroundImage.copyright);
      introBackground.setThumbnail(new H5P.Thumbnail(H5P.getPath(params.introPage.backgroundImage.path, contentId), params.introPage.backgroundImage.width, params.introPage.backgroundImage.height));
      info.addMedia(introBackground);
    }

    // Background
    if (params.backgroundImage !== undefined && params.backgroundImage.copyright !== undefined) {
      var background = new H5P.MediaCopyright(params.backgroundImage.copyright);
      background.setThumbnail(new H5P.Thumbnail(H5P.getPath(params.backgroundImage.path, contentId), params.backgroundImage.width, params.backgroundImage.height));
      info.addMedia(background);
    }

    // Questions
    var questionCopyrights;
    for (var i = 0; i < questionInstances.length; i++) {
      var instance = questionInstances[i];
      var instanceParams = params.questions[i].params;

      questionCopyrights = undefined;

      if (instance.getCopyrights !== undefined) {
        // Use the instance's own copyright generator
        questionCopyrights = instance.getCopyrights();
      }
      if (questionCopyrights === undefined) {
        // Create a generic flat copyright list
        questionCopyrights = new H5P.ContentCopyrights();
        H5P.findCopyrights(questionCopyrights, instanceParams.params, contentId,{
          metadata: instanceParams.metadata,
          machineName: instanceParams.library.split(' ')[0]
        });
      }

      // Determine label
      var label = (params.texts.questionLabel + ' ' + (i + 1));
      if (instanceParams.params.contentName !== undefined) {
        label += ': ' + instanceParams.params.contentName;
      }
      else if (instance.getTitle !== undefined) {
        label += ': ' + instance.getTitle();
      }
      questionCopyrights.setLabel(label);

      // Add info
      info.addContent(questionCopyrights);
    }

    // Success video
    var video;
    if (params.endGame.successVideo !== undefined && params.endGame.successVideo.length > 0) {
      video = params.endGame.successVideo[0];
      if (video.copyright !== undefined) {
        info.addMedia(new H5P.MediaCopyright(video.copyright));
      }
    }

    // Fail video
    if (params.endGame.failVideo !== undefined && params.endGame.failVideo.length > 0) {
      video = params.endGame.failVideo[0];
      if (video.copyright !== undefined) {
        info.addMedia(new H5P.MediaCopyright(video.copyright));
      }
    }

    return info;
  };
  this.getQuestions = function () {
    return questionInstances;
  };
  this.showSolutions = function () {
    renderSolutions = true;
  };

  /**
   * Returns the complete state of question set and sub-content
   *
   * @returns {Object} current state
   */
  this.getCurrentState = function () {
    const progress = showingSolutions ? questionInstances.length - 1 : currentQuestion;
    const answers = questionInstances.map(function (qi) {
      return qi.getCurrentState();
    });

    // If the user has moved past the first question, if the content has been resumed,
    // or if at least one of the answers to the questions are considered not empty.
    if (progress || self.hasPrevState || answers.some(answer => !H5P.isEmpty(answer))) {
      return {
        progress: progress,
        answers: answers,
        order: questionOrder,
        poolOrder: poolOrder,
      };
    }

    return {};
  };

  /**
   * Trigger the xAPI progressed event
   */
  this.triggerXAPIProgressed = function () {
    const progressedEvent = this.createXAPIEventTemplate('progressed');
    if (progressedEvent.data.statement.context.extensions === undefined) {
      progressedEvent.data.statement.context.extensions = {};
    }
    
    progressedEvent.data.statement.context.extensions['http://id.tincanapi.com/extension/ending-point'] = currentQuestion + 1;
    this.trigger(progressedEvent);
  }

  /**
   * Generate xAPI object definition used in xAPI statements.
   * @return {Object}
   */
  var getxAPIDefinition = function () {
    var definition = {};

    definition.interactionType = 'compound';
    definition.type = 'http://adlnet.gov/expapi/activities/cmi.interaction';
    definition.description = {
      'en-US': ''
    };

    return definition;
  };

  /**
   * Add the question itself to the definition part of an xAPIEvent
   */
  var addQuestionToXAPI = function (xAPIEvent) {
    var definition = xAPIEvent.getVerifiedStatementValue(['object', 'definition']);
    $.extend(definition, getxAPIDefinition());
  };

  /**
   * Get xAPI data from sub content types
   *
   * @param {Object} metaContentType
   * @returns {array}
   */
  var getXAPIDataFromChildren = function (metaContentType) {
    return metaContentType.getQuestions().map(function (question) {
      return question.getXAPIData();
    });
  };

  /**
   * Get xAPI data.
   * Contract used by report rendering engine.
   *
   * @see contract at {@link https://h5p.org/documentation/developers/contracts#guides-header-6}
   */
  this.getXAPIData = function () {
    var xAPIEvent = this.createXAPIEventTemplate('answered');
    addQuestionToXAPI(xAPIEvent);
    xAPIEvent.setScoredResult(this.getScore(),
      this.getMaxScore(),
      this,
      true,
      this.getScore() === this.getMaxScore()
    );
    return {
      statement: xAPIEvent.data.statement,
      children: getXAPIDataFromChildren(this)
    };
  };

  /**
   * Get context data.
   * Contract used for confusion report.
   */
  this.getContext = function () {
    // Get question index and add 1, count starts from 0
    let contextObject = {
      type: 'question',
      value: (currentQuestion + 1)
    };

    // Send actual index of the question if questions are randomized
    if (params.randomQuestions) {
      contextObject.actual = questionOrder[currentQuestion] + 1;
    }
    return contextObject;
  };
};

H5P.QuestionSetPapiJo.prototype = Object.create(H5P.EventDispatcher.prototype);
H5P.QuestionSetPapiJo.prototype.constructor = H5P.QuestionSetPapiJo;
