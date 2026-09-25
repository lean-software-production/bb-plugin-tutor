Feature: Widgets

  The works makes widgets.

  Background:
    Given an empty works

  Example: A loose example
    When nothing happens
    Then nothing is made

  Rule: The works makes a widget

    Example: One widget
      When the works runs
      Then there is exactly one widget

    Example: A widget from a drawing
      Given this drawing:
        """dot
          digraph widget {
              top   ->   bottom
          }
        """
      When the works runs
      Then the widget matches the drawing

  Rule: Widgets can be counted

    Example: Widgets in a table
      Given these widgets:
        | name  | size |
        | small | 1    |
      Then the works knows both
