// Пример теста для QuizEngine
const sampleQuiz = {
    title: "Test",
    timeLimitSec: 60,
    passThreshold: 0.7,
    questions: [
      { id: "q1", text: "A?", options: ["1", "2"], correctIndex: 1 },
      { id: "q2", text: "B?", options: ["3", "4"], correctIndex: 0 }
    ]
  };
  
  test("QuizEngine counts correct answers", () => {
    const engine = new QuizEngine(sampleQuiz);
    engine.select(1); // q1: correct
    engine.next();
    engine.select(1); // q2: incorrect
    const result = engine.finish();
    expect(result.correct).toBe(1);
    expect(result.total).toBe(2);
    expect(result.passed).toBe(false);
  });
