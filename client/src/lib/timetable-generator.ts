import { 
  Course, Instructor, Classroom, ScheduledClass, Constraint,
  Department, weekDays, timeSlots
} from "@shared/schema";

// Types for constraints
type ConstraintType = 'instructor_unavailable' | 'room_unavailable' | 'course_conflict';

// Types for time slots and days
type TimeSlot = typeof timeSlots[number];
type WeekDay = typeof weekDays[number];

// Type for a class slot (day + time)
interface ClassSlot {
  day: WeekDay;
  timeSlot: TimeSlot;
}

// Interface for the generator
export interface TimetableGeneratorOptions {
  courses: Course[];
  instructors: Instructor[];
  classrooms: Classroom[];
  constraints: Constraint[];
  timetableId: number;
}

/**
 * Generate a timetable based on courses, instructors, classrooms, and constraints
 */
export const generateTimetable = async (options: TimetableGeneratorOptions): Promise<ScheduledClass[]> => {
  const { courses, instructors, classrooms, constraints, timetableId } = options;
  
  // Create a map of all available time slots
  const allSlots: ClassSlot[] = [];
  for (const day of weekDays) {
    for (const timeSlot of timeSlots) {
      allSlots.push({ day, timeSlot });
    }
  }
  
  // Initialize variables for tracking assignments
  const scheduledClasses: ScheduledClass[] = [];
  const instructorAssignments: Record<number, ClassSlot[]> = {};
  const classroomAssignments: Record<number, ClassSlot[]> = {};
  const courseAssignments: Record<number, ClassSlot[]> = {};
  
  // Process constraints
  const instructorUnavailable: Record<number, ClassSlot[]> = {};
  const roomUnavailable: Record<number, ClassSlot[]> = {};
  const courseConflicts: Record<number, number[]> = {}; // courseId -> conflicting course IDs
  
  for (const constraint of constraints) {
    const { type, entityId, day, timeSlot } = constraint;
    
    if (type === 'instructor_unavailable') {
      if (!instructorUnavailable[entityId]) {
        instructorUnavailable[entityId] = [];
      }
      instructorUnavailable[entityId].push({ day, timeSlot } as ClassSlot);
    } 
    else if (type === 'room_unavailable') {
      if (!roomUnavailable[entityId]) {
        roomUnavailable[entityId] = [];
      }
      roomUnavailable[entityId].push({ day, timeSlot } as ClassSlot);
    }
    else if (type === 'course_conflict') {
      // The entity ID in this case is the course ID
      // And timeSlot field is used to store the conflicting course ID (a bit of a hack)
      const courseId = entityId;
      const conflictingCourseId = parseInt(timeSlot);
      
      if (!courseConflicts[courseId]) {
        courseConflicts[courseId] = [];
      }
      if (!courseConflicts[conflictingCourseId]) {
        courseConflicts[conflictingCourseId] = [];
      }
      
      courseConflicts[courseId].push(conflictingCourseId);
      courseConflicts[conflictingCourseId].push(courseId);
    }
  }
  
  // Sort courses by number of constraints (most constrained first)
  const sortedCourses = [...courses].sort((a, b) => {
    const aConstraints = (courseConflicts[a.id]?.length || 0) + 
                       (instructorUnavailable[a.instructorId]?.length || 0);
    const bConstraints = (courseConflicts[b.id]?.length || 0) + 
                       (instructorUnavailable[b.instructorId]?.length || 0);
    return bConstraints - aConstraints;
  });
  
  // Helper function to check if a slot is available for a course
  const isSlotAvailable = (course: Course, slot: ClassSlot, roomId: number): boolean => {
    const { day, timeSlot } = slot;
    
    // Check instructor availability
    const instructorId = course.instructorId;
    if (instructorUnavailable[instructorId]?.some(s => 
      s.day === day && s.timeSlot === timeSlot)) {
      return false;
    }
    if (instructorAssignments[instructorId]?.some(s => 
      s.day === day && s.timeSlot === timeSlot)) {
      return false;
    }
    
    // Check room availability
    if (roomUnavailable[roomId]?.some(s => 
      s.day === day && s.timeSlot === timeSlot)) {
      return false;
    }
    if (classroomAssignments[roomId]?.some(s => 
      s.day === day && s.timeSlot === timeSlot)) {
      return false;
    }
    
    // Check course conflicts
    if (courseConflicts[course.id]) {
      for (const conflictingCourseId of courseConflicts[course.id]) {
        if (courseAssignments[conflictingCourseId]?.some(s => 
          s.day === day && s.timeSlot === timeSlot)) {
          return false;
        }
      }
    }
    
    return true;
  };
  
  // Assign courses to time slots
  for (const course of sortedCourses) {
    // Find suitable classrooms (with enough capacity)
    const suitableRooms = classrooms
      .filter(room => room.capacity >= course.capacity)
      .sort((a, b) => a.capacity - b.capacity); // Prefer smaller rooms that fit
    
    if (suitableRooms.length === 0) {
      console.warn(`No suitable rooms for course ${course.code}`);
      continue;
    }
    
    // Determine how many time slots this course needs (based on credits)
    const slotsNeeded = course.credits >= 4 ? 3 : (course.credits >= 3 ? 2 : 1);
    
    // Try to assign the course to consecutive time slots on the same day if possible
    let assigned = false;
    
    // Create a randomized order of days to better distribute classes across the week
    // This will prevent the algorithm from always filling Monday first
    const shuffledDays = [...weekDays].sort(() => Math.random() - 0.5);
    
    // First try consecutive slots on the same day
    for (const room of suitableRooms) {
      if (assigned) break;
      
      for (const day of shuffledDays) {
        if (assigned) break;
        
        // Randomize the starting slot position to avoid always starting early in the day
        const slotIndices = Array.from(
          { length: timeSlots.length - slotsNeeded + 1 }, 
          (_, i) => i
        ).sort(() => Math.random() - 0.5);
        
        for (const startIdx of slotIndices) {
          // Check if all consecutive slots are available
          let allAvailable = true;
          for (let j = 0; j < slotsNeeded; j++) {
            const slot = { day, timeSlot: timeSlots[startIdx + j] };
            if (!isSlotAvailable(course, slot, room.id)) {
              allAvailable = false;
              break;
            }
          }
          
          if (allAvailable) {
            // Assign this course to these slots
            for (let j = 0; j < slotsNeeded; j++) {
              const slot = { day, timeSlot: timeSlots[startIdx + j] };
              
              // Update assignments
              if (!instructorAssignments[course.instructorId]) {
                instructorAssignments[course.instructorId] = [];
              }
              instructorAssignments[course.instructorId].push(slot);
              
              if (!classroomAssignments[room.id]) {
                classroomAssignments[room.id] = [];
              }
              classroomAssignments[room.id].push(slot);
              
              if (!courseAssignments[course.id]) {
                courseAssignments[course.id] = [];
              }
              courseAssignments[course.id].push(slot);
              
              // Create scheduled class
              const startTime = slot.timeSlot.split('-')[0].trim();
              const endTime = j === slotsNeeded - 1 
                ? slot.timeSlot.split('-')[1].trim() 
                : timeSlots[startIdx + j + 1].split('-')[0].trim();
              
              scheduledClasses.push({
                id: 0, // Will be assigned by the backend
                courseId: course.id,
                instructorId: course.instructorId,
                classroomId: room.id,
                day: slot.day,
                startTime,
                endTime,
                timetableId
              });
            }
            
            assigned = true;
            break;
          }
        }
      }
    }
    
    // If not assigned with consecutive slots, try individual slots across different days
    if (!assigned) {
      let assignedSlots = 0;
      
      // Shuffle all slots to distribute classes better
      const shuffledSlots = [...allSlots].sort(() => Math.random() - 0.5);
      
      for (const room of suitableRooms) {
        if (assignedSlots >= slotsNeeded) break;
        
        for (const slot of shuffledSlots) {
          if (assignedSlots >= slotsNeeded) break;
          
          if (isSlotAvailable(course, slot, room.id)) {
            // Update assignments
            if (!instructorAssignments[course.instructorId]) {
              instructorAssignments[course.instructorId] = [];
            }
            instructorAssignments[course.instructorId].push(slot);
            
            if (!classroomAssignments[room.id]) {
              classroomAssignments[room.id] = [];
            }
            classroomAssignments[room.id].push(slot);
            
            if (!courseAssignments[course.id]) {
              courseAssignments[course.id] = [];
            }
            courseAssignments[course.id].push(slot);
            
            // Create scheduled class
            const [startTime, endTime] = slot.timeSlot.split('-').map(t => t.trim());
            
            scheduledClasses.push({
              id: 0, // Will be assigned by the backend
              courseId: course.id,
              instructorId: course.instructorId,
              classroomId: room.id,
              day: slot.day,
              startTime,
              endTime,
              timetableId
            });
            
            assignedSlots++;
          }
        }
      }
      
      if (assignedSlots < slotsNeeded) {
        console.warn(`Could only assign ${assignedSlots}/${slotsNeeded} slots for course ${course.code}`);
      }
    }
  }
  
  return scheduledClasses;
};

/**
 * Check for conflicts in a timetable
 */
export const checkConflicts = (scheduledClasses: ScheduledClass[]): {
  instructorConflicts: any[];
  classroomConflicts: any[];
  studentConflicts: any[];
} => {
  const instructorConflicts: any[] = [];
  const classroomConflicts: any[] = [];
  const studentConflicts: any[] = [];
  
  // Check for instructor conflicts (same instructor, same time)
  const instructorSlots: Record<number, Record<string, ScheduledClass[]>> = {};
  
  for (const scheduledClass of scheduledClasses) {
    const instructorId = scheduledClass.instructorId;
    const key = `${scheduledClass.day}-${scheduledClass.startTime}-${scheduledClass.endTime}`;
    
    if (!instructorSlots[instructorId]) {
      instructorSlots[instructorId] = {};
    }
    
    if (!instructorSlots[instructorId][key]) {
      instructorSlots[instructorId][key] = [];
    }
    
    instructorSlots[instructorId][key].push(scheduledClass);
    
    if (instructorSlots[instructorId][key].length > 1) {
      instructorConflicts.push({
        instructorId,
        classes: instructorSlots[instructorId][key]
      });
    }
  }
  
  // Check for classroom conflicts (same classroom, same time)
  const classroomSlots: Record<number, Record<string, ScheduledClass[]>> = {};
  
  for (const scheduledClass of scheduledClasses) {
    const classroomId = scheduledClass.classroomId;
    const key = `${scheduledClass.day}-${scheduledClass.startTime}-${scheduledClass.endTime}`;
    
    if (!classroomSlots[classroomId]) {
      classroomSlots[classroomId] = {};
    }
    
    if (!classroomSlots[classroomId][key]) {
      classroomSlots[classroomId][key] = [];
    }
    
    classroomSlots[classroomId][key].push(scheduledClass);
    
    if (classroomSlots[classroomId][key].length > 1) {
      classroomConflicts.push({
        classroomId,
        classes: classroomSlots[classroomId][key]
      });
    }
  }
  
  // Student conflicts are more complex and would require student enrollment data
  // This is a simplified version that assumes students take all courses in their department
  const departmentSlots: Record<string, Record<string, ScheduledClass[]>> = {};
  
  for (const scheduledClass of scheduledClasses) {
    // We need course information to get the department
    // This would require joining with course data
    // For now, we'll skip this part
  }
  
  return {
    instructorConflicts,
    classroomConflicts,
    studentConflicts
  };
};
