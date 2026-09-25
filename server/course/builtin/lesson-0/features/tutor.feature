Feature: Your tutor

  The tutor turns the course into a conversation with a coach. The course
  outline in the sidebar shows every lesson and where you are, and the coach
  works through each lesson with you in its own thread, one Rule at a time.

  These examples are about the tutor itself, not your factory. You check
  them off the way you will check off every lesson after this one: by
  doing what they say and telling your coach what you saw.

  Background:
    Given you have started Lesson 0

  Rule: The course outline shows where you are

    Example: The lesson you are on is marked
      When you look at the course outline in the sidebar
      Then Lesson 0 is open as the lesson you are on
      And it counts how many of its examples have passed

    Example: The Rule in focus is marked
      Given your coach has put a Rule in focus
      When you look under your coach thread in the course outline
      Then that Rule is marked as the one in focus

  Rule: The lesson leads your coach thread

    Example: The lesson opens the thread
      When you open your coach thread
      Then your coach's first reply opens with the lesson and its Rules

    Example: A Rule opens where your coach started it
      Given your coach has started on a Rule
      When you choose that Rule in the course outline
      Then the coach thread scrolls to that Rule's card

    Example: Coming back later
      Given you have left your coach thread
      When you choose "Continue with your coach" on BB's home page
      Then you are back in the thread with your coach, where you left off

  Rule: You can ask your coach anything

    Example: A question about what to do next
      When you ask your coach "what should I do first?"
      Then the coach answers in the same thread
      And its answer names the Rule in focus

  Rule: A side question goes in a side chat

    Example: A side chat opens beside your coach
      When you ask a side question about the Rule in focus
      Then a side chat opens in the "Side chat" tab beside your coach thread
      And it appears in the course outline under your lesson

    Example: Your coach thread stays where it was
      Given you have asked something in a side chat
      When you look back at your coach thread
      Then the conversation there carries on from where it was

  Rule: Progress cards say what changed

    Example: An example passes
      When your coach checks off an example
      Then a progress card in the thread names the example
      And it says how many of the lesson's examples have passed

    Example: A term you do not know
      When your coach uses a term from the course's lexicon
      Then a term chip appears in the thread
      And opening it shows what the term means
