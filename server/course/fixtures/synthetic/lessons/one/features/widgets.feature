@core
Feature: Widgets

    The works makes widgets.

      Indented detail stays indented.

  Background:
    Given an empty works

  Example: A loose example
    When nothing happens
    Then nothing is made

  Rule: The works makes a widget

    Widgets are round.

    Background:
      Given a round mould

    Example: One widget
      When the works runs
      Then there is one widget

    @real-agent @slow
    Example: A widget from a drawing
      Given this drawing:
        """dot
        digraph widget {
          top -> bottom
        }
        """
      When the works runs
      Then the widget matches the drawing

    Example: One widget
      Given a spare mould
      When the works runs
      Then there are two widgets

  Rule: General

    Example: Widgets in a table
      Given these widgets:
        | name  | size |
        | small | 1    |
      Then the works knows both
