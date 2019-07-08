package db;

import db.mongob.MongoDBConnection;
import db.mysql.MySQLConnection;

public class DBConnectionFactory {
	// This should change based on the pipeline.
		private static final String DEFAULT_DB = "mysql";
// 这里是一个batabase 的switch 转换器 和 不同db的转换 和联系 		
		public static DBConnection getConnection(String db) {
			switch (db) {
			case "mysql":
				return new MySQLConnection();
			case "mongodb":
				return new MongoDBConnection();
			default:
				throw new IllegalArgumentException("Invalid db:" + db);
			}

		}

		public static DBConnection getConnection() {
			return getConnection(DEFAULT_DB);
		}
}
