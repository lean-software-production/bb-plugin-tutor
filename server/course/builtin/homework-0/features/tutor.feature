Feature: Your tutor

  The tutor turns the course into a conversation with a coach. The course
  rail shows where you are, the lesson page shows what the homework asks
  for, and the coach works through it with you one Rule at a time.

  These examples are about the tutor itself, not your factory. You check
  them off the way you will check off every homework after this one: by
  doing what they say and telling your coach what you saw.

  Background:
    Given you have started Homework 0

  Rule: The course rail shows where you are

    Example: The homework you are on is marked
      When you look at the course rail
      Then it marks Homework 0 as the homework you are on
      And it counts how many of its examples have passed

    Example: The Rule in focus is marked
      Given your coach has put a Rule in focus
      When you look at the course rail
      Then that Rule is marked as the one in focus

  Rule: The lesson opens as a thread with your coach

    Example: The lesson leads the thread
      When you open the lesson
      Then the homework is at the top of the page
      And your conversation with the coach follows beneath it

    Example: Coming back later
      Given you have left the lesson
      When you choose "Continue with your coach" on BB's home page
      Then you are back in the thread with your coach, where you left off

  Rule: You can ask your coach anything

    Example: A question about what to do next
      When you ask your coach "what should I do first?"
      Then the coach answers in the same thread
      And its answer names the Rule in focus

  Rule: A side thread belongs to the Rule it came from

    Example: A side thread appears under its Rule
      When you spin off a side thread from the Rule in focus
      Then it appears in the course rail's conversations, under your coach
      And its Rule tab shows the Rule it came from

    Example: Back to your coach
      Given you are in a side thread
      When you choose "Back to coach" on its Rule tab
      Then you are back in the thread with your coach

  Rule: Progress cards say what changed

    Example: An example passes
      When your coach checks off an example
      Then a progress card in the thread names the example
      And it says how many of the Rule's examples have passed

    Example: A term you do not know
      When your coach uses a term from the course's lexicon
      Then a term chip appears in the thread
      And opening it shows what the term means
